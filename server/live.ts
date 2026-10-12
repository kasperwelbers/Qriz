import { and, asc, count, eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import type { User } from "./auth.ts";
import { config } from "./config.ts";
import { randomId } from "./crypto.ts";
import { db, schema } from "./db/index.ts";

type Question = typeof schema.questions.$inferSelect;
type Phase = "lobby" | "question" | "closed" | "ended";
type Role = "presenter" | "student";

interface Conn {
  ws: WSContext;
  user: User;
  role: Role;
}

/**
 * In-memory state of a run that is being presented. A single server process owns
 * all live runs, so no external pub/sub is needed. If the process restarts, a run
 * resumes in the lobby and the teacher continues with "next question".
 */
class LiveRun {
  phase: Phase = "lobby";
  qIndex = -1;
  servedAt = 0;
  deadline = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private conns = new Set<Conn>();
  /** Users who hid the page or lost connection during the current question, with the reason. */
  private focusLost = new Map<string, string>();

  constructor(
    readonly runId: string,
    readonly task: typeof schema.tasks.$inferSelect,
    readonly questions: Question[],
    ended: boolean,
  ) {
    if (ended) this.phase = "ended";
  }

  get current(): Question | undefined {
    return this.questions[this.qIndex];
  }

  join(conn: Conn) {
    this.conns.add(conn);
    this.send(conn);
  }

  leave(conn: Conn) {
    this.conns.delete(conn);
    if (conn.role === "student" && this.phase === "question" && config.disqualifyOnDisconnect) {
      // On phones, switching apps usually kills the socket before a visibility event arrives.
      this.markFocusLost(conn.user.id, "connection lost");
    }
  }

  next() {
    if (this.phase === "ended" || this.qIndex >= this.questions.length - 1) return false;
    this.qIndex++;
    this.phase = "question";
    this.focusLost.clear();
    this.servedAt = Date.now();
    this.deadline = this.servedAt + this.current!.timeLimitSec * 1000;
    this.clearTimer();
    this.timer = setTimeout(() => this.close(), this.deadline - Date.now() + config.answerGraceMs);
    this.broadcast();
    return true;
  }

  close() {
    if (this.phase !== "question") return;
    this.clearTimer();
    this.phase = "closed";
    this.broadcast();
  }

  end() {
    this.clearTimer();
    this.phase = "ended";
    db.update(schema.runs).set({ endedAt: Date.now() }).where(eq(schema.runs.id, this.runId)).run();
    this.broadcast();
    for (const c of this.conns) if (c.role === "student") c.ws.close(1000, "ended");
  }

  onCheckin() {
    this.broadcast("presenter");
  }

  handleMessage(conn: Conn, raw: string) {
    try {
      this.handleMessageUnsafe(conn, raw);
    } catch (err) {
      console.error("live: failed to handle message", err);
    }
  }

  private handleMessageUnsafe(conn: Conn, raw: string) {
    if (conn.role !== "student") return;
    let msg: { type?: string; questionId?: string; choice?: number; state?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "focus" && msg.state === "hidden" && this.phase === "question") {
      this.markFocusLost(conn.user.id, "left the page");
    } else if (msg.type === "answer") {
      const error = this.answer(conn.user, String(msg.questionId), Number(msg.choice));
      if (error) conn.ws.send(JSON.stringify({ type: "error", error }));
    }
  }

  private answer(user: User, questionId: string, choice: number): string | null {
    const q = this.current;
    const now = Date.now();
    if (this.phase !== "question" || !q || q.id !== questionId) return "This question is closed";
    if (now > this.deadline + config.answerGraceMs) return "Time is up";
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return "Invalid answer";
    if (!isCheckedIn(this.runId, user.id)) return "Scan the QR code to join first";

    const reason = this.focusLost.get(user.id) ?? null;
    const inserted = db
      .insert(schema.answers)
      .values({ id: randomId(), runId: this.runId, questionId, userId: user.id, choice, servedAt: this.servedAt, answeredAt: now, disqualified: reason !== null, reason })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!inserted) return "You already answered";
    this.broadcast();
    return null;
  }

  private markFocusLost(userId: string, reason: string) {
    if (this.focusLost.has(userId)) return;
    this.focusLost.set(userId, reason);
    const q = this.current;
    if (q) {
      db.update(schema.answers)
        .set({ disqualified: true, reason })
        .where(and(eq(schema.answers.runId, this.runId), eq(schema.answers.questionId, q.id), eq(schema.answers.userId, userId)))
        .run();
    }
    this.broadcast();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private broadcast(only?: Role) {
    for (const c of this.conns) if (!only || c.role === only) this.send(c);
  }

  private send(conn: Conn) {
    try {
      this.sendUnsafe(conn);
    } catch (err) {
      console.error("live: failed to send state", err);
    }
  }

  private sendUnsafe(conn: Conn) {
    const q = this.current;
    const base = {
      type: "state",
      kind: this.task.kind,
      title: this.task.title,
      phase: this.phase,
      qIndex: this.qIndex,
      total: this.questions.length,
      deadline: this.deadline,
      serverNow: Date.now(),
      timeLimitSec: q?.timeLimitSec ?? 0,
      optionCount: q?.options.length ?? 0,
      questionId: q?.id ?? null,
    };

    if (conn.role === "student") {
      // Students never receive question text or options: those only appear on the projector.
      const mine = q
        ? db
            .select()
            .from(schema.answers)
            .where(and(eq(schema.answers.runId, this.runId), eq(schema.answers.questionId, q.id), eq(schema.answers.userId, conn.user.id)))
            .get()
        : undefined;
      conn.ws.send(
        JSON.stringify({
          ...base,
          myAnswer: mine?.choice ?? null,
          disqualified: mine?.disqualified || this.focusLost.has(conn.user.id),
          correctIndex: this.phase === "closed" ? (q?.correctIndex ?? null) : null,
        }),
      );
      return;
    }

    const answers = q
      ? db
          .select()
          .from(schema.answers)
          .where(and(eq(schema.answers.runId, this.runId), eq(schema.answers.questionId, q.id)))
          .all()
      : [];
    const counts = (q?.options ?? []).map((_, i) => answers.filter((a) => a.choice === i && !a.disqualified).length);
    const checkinCount = db.select({ n: count() }).from(schema.checkins).where(eq(schema.checkins.runId, this.runId)).get()!.n;
    conn.ws.send(
      JSON.stringify({
        ...base,
        prompt: q?.prompt ?? null,
        options: q?.options ?? [],
        correctIndex: this.phase === "closed" ? (q?.correctIndex ?? null) : null,
        counts,
        answeredCount: answers.length,
        disqualifiedCount: answers.filter((a) => a.disqualified).length + [...this.focusLost.keys()].filter((u) => !answers.some((a) => a.userId === u)).length,
        checkinCount,
        connectedStudents: [...this.conns].filter((c) => c.role === "student").length,
      }),
    );
  }
}

const live = new Map<string, LiveRun>();

export function getLiveRun(runId: string): LiveRun | null {
  const existing = live.get(runId);
  if (existing) return existing;
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
  if (!run) return null;
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, run.taskId)).get()!;
  const questions = db.select().from(schema.questions).where(eq(schema.questions.taskId, task.id)).orderBy(asc(schema.questions.position)).all();
  const lr = new LiveRun(runId, task, questions, run.endedAt !== null);
  live.set(runId, lr);
  return lr;
}

export function isCheckedIn(runId: string, userId: string): boolean {
  return !!db
    .select({ id: schema.checkins.id })
    .from(schema.checkins)
    .where(and(eq(schema.checkins.runId, runId), eq(schema.checkins.userId, userId)))
    .get();
}

export type { Conn, LiveRun };
