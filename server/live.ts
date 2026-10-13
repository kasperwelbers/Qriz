import { and, asc, eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import type { User } from "./auth.ts";
import { type Check, CHECKS, type CheckSettings, checkSettings } from "./checks.ts";
import { config } from "./config.ts";
import { randomId, sha256 } from "./crypto.ts";
import { db, schema } from "./db/index.ts";

type Question = typeof schema.questions.$inferSelect;
type Phase = "lobby" | "question" | "paper" | "closed" | "ended";
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
  /** When on, a paper round follows each question: options appear on the projector after phones are locked. */
  paperRound = false;
  /** Show checked-in students' names in the lobby, so the class can see who is "present". */
  showNames = true;
  /** Show the typed answers to an open question on the projector (off until the teacher chooses to). */
  showResponses = false;
  qIndex = -1;
  servedAt = 0;
  deadline = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private conns = new Set<Conn>();
  /** Checks that fired per user during the current question. What that means is up to the task's check settings. */
  private events = new Map<string, Set<Check>>();
  readonly checks: CheckSettings;

  constructor(
    readonly runId: string,
    readonly task: typeof schema.tasks.$inferSelect,
    readonly questions: Question[],
    ended: boolean,
  ) {
    if (ended) this.phase = "ended";
    this.checks = checkSettings(task.checks);
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
    if (conn.role === "student" && this.phase === "question") this.checkFired(conn.user.id, "connectionLost");
  }

  next() {
    if (this.phase === "ended" || this.qIndex >= this.questions.length - 1) return false;
    this.qIndex++;
    this.phase = "question";
    this.showResponses = false;
    this.events.clear();
    this.servedAt = Date.now();
    this.deadline = this.servedAt + this.current!.timeLimitSec * 1000;
    this.clearTimer();
    this.timer = setTimeout(() => this.endQuestion(), this.deadline - Date.now() + config.answerGraceMs);
    this.broadcast();
    return true;
  }

  /** Locks phone answers; continues with the paper round if enabled, else reveals. */
  endQuestion() {
    if (this.phase !== "question") return;
    this.clearTimer();
    if (!this.paperRound || this.current?.type === "open") return this.close();
    this.phase = "paper";
    this.deadline = Date.now() + config.paperSeconds * 1000;
    this.timer = setTimeout(() => this.close(), config.paperSeconds * 1000);
    this.broadcast();
  }

  close() {
    if (this.phase !== "question" && this.phase !== "paper") return;
    this.clearTimer();
    this.phase = "closed";
    this.broadcast();
  }

  setShowNames(on: boolean) {
    this.showNames = on;
    this.broadcast("presenter");
  }

  setShowResponses(on: boolean) {
    this.showResponses = on;
    this.broadcast("presenter");
  }

  setPaperRound(on: boolean) {
    this.paperRound = on;
    this.broadcast("presenter");
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
    let msg: { type?: string; questionId?: string; choice?: number; text?: string; confidence?: number; state?: string; reason?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "focus" && msg.state === "hidden" && this.phase === "question") {
      this.checkFired(conn.user.id, msg.reason === "split screen" ? "splitScreen" : "leftPage");
    } else if (msg.type === "answer") {
      const error = this.answer(conn.user, String(msg.questionId), msg);
      if (error) conn.ws.send(JSON.stringify({ type: "error", error }));
    }
  }

  private answer(user: User, questionId: string, msg: { choice?: number; text?: string; confidence?: number }): string | null {
    const q = this.current;
    const now = Date.now();
    if (this.phase !== "question" || !q || q.id !== questionId) return "This question is closed";
    if (now > this.deadline + config.answerGraceMs) return "Time is up";
    let choice: number | null = null;
    let text: string | null = null;
    let confidence: number | null = null;
    if (q.type === "open") {
      text = String(msg.text ?? "").trim().slice(0, 500);
      if (!text) return "Type an answer first";
    } else {
      choice = Number(msg.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return "Invalid answer";
      if (q.askConfidence && msg.confidence !== undefined) confidence = Math.max(0, Math.min(100, Math.round(Number(msg.confidence)) || 0));
    }
    if (!isCheckedIn(this.runId, user.id)) return "Scan the QR code to join first";

    const fired = [...(this.events.get(user.id) ?? [])];
    const dq = fired.find((c) => this.checks[c] === "disqualify");
    const flags = fired.filter((c) => this.checks[c] !== "disqualify").map((c) => CHECKS[c].label);
    const inserted = db
      .insert(schema.answers)
      .values({
        id: randomId(),
        runId: this.runId,
        questionId,
        userId: user.id,
        choice,
        text,
        confidence,
        servedAt: this.servedAt,
        answeredAt: now,
        disqualified: dq !== undefined,
        reason: dq ? CHECKS[dq].label : null,
        flag: flags.length ? flags.join("; ") : null,
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!inserted) return "You already answered";
    this.broadcast();
    return null;
  }

  /** A check fired for this user during the current question; the task's settings decide what it does to their answer. */
  private checkFired(userId: string, check: Check) {
    const fired = this.events.get(userId) ?? new Set<Check>();
    if (fired.has(check)) return;
    fired.add(check);
    this.events.set(userId, fired);
    const q = this.current;
    const where = q && and(eq(schema.answers.runId, this.runId), eq(schema.answers.questionId, q.id), eq(schema.answers.userId, userId));
    const existing = where && db.select().from(schema.answers).where(where).get();
    if (existing) {
      const label = CHECKS[check].label;
      if (this.checks[check] === "disqualify") {
        if (!existing.disqualified) db.update(schema.answers).set({ disqualified: true, reason: label }).where(where).run();
      } else {
        db.update(schema.answers).set({ flag: existing.flag ? `${existing.flag}; ${label}` : label }).where(where).run();
      }
    }
    // A recorded check is silent: nothing changes on any screen.
    if (this.checks[check] !== "record") this.broadcast();
  }

  private disqualifiedBy(userId: string): boolean {
    return [...(this.events.get(userId) ?? [])].some((c) => this.checks[c] === "disqualify");
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
      qType: q?.type ?? "choice",
      askConfidence: q?.askConfidence ?? false,
    };

    if (conn.role === "student") {
      // The question text only appears on the projector. Options are sent in a per-student order,
      // so "the answer is B" can't be passed around.
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
          choices: q ? shuffledOptions(q, conn.user.id) : [],
          myAnswer: mine?.choice ?? null,
          myText: mine?.text ?? null,
          answered: !!mine,
          disqualified: mine?.disqualified || this.disqualifiedBy(conn.user.id),
          warnings: [...(this.events.get(conn.user.id) ?? [])].filter((c) => this.checks[c] === "warn").map((c) => CHECKS[c].label),
          // The client only blocks the buttons in split screen when split screen would disqualify anyway.
          splitScreenBlocks: this.checks.splitScreen === "disqualify",
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
    const valid = answers.filter((a) => !a.disqualified);
    const counts = (q?.options ?? []).map((_, i) => valid.filter((a) => a.choice === i).length);
    // Average confidence per option, so the class can discuss "we were all sure, and all wrong".
    const confidence = (q?.options ?? []).map((_, i) => {
      const cs = valid.filter((a) => a.choice === i && a.confidence !== null).map((a) => a.confidence!);
      return cs.length ? Math.round(cs.reduce((x, y) => x + y, 0) / cs.length) : null;
    });
    const checkedIn = db
      .select({ name: schema.users.name })
      .from(schema.checkins)
      .innerJoin(schema.users, eq(schema.users.id, schema.checkins.userId))
      .where(eq(schema.checkins.runId, this.runId))
      .orderBy(asc(schema.checkins.scannedAt))
      .all();
    const checkinCount = checkedIn.length;
    conn.ws.send(
      JSON.stringify({
        ...base,
        prompt: q?.prompt ?? null,
        // While phones can answer, the projector shows only the question, so nobody can signal "it's the 2nd one".
        options: this.phase === "question" ? [] : (q?.options ?? []),
        paperRound: this.paperRound,
        correctIndex: this.phase === "closed" ? (q?.correctIndex ?? null) : null,
        counts,
        confidence: q?.askConfidence ? confidence : null,
        showResponses: this.showResponses,
        // Typed answers are anonymous on the projector, and only shown after the question closes and the teacher chooses to.
        responses: q?.type === "open" && this.phase === "closed" && this.showResponses ? valid.map((a) => a.text ?? "") : [],
        answeredCount: answers.length,
        disqualifiedCount:
          answers.filter((a) => a.disqualified).length + [...this.events.keys()].filter((u) => this.disqualifiedBy(u) && !answers.some((a) => a.userId === u)).length,
        checkinCount,
        showNames: this.showNames,
        names: this.showNames ? checkedIn.map((c) => c.name ?? "(no name yet)") : [],
        connectedStudents: [...this.conns].filter((c) => c.role === "student").length,
      }),
    );
  }
}

/** Options in a stable per-student random order, keeping each option's original index. */
function shuffledOptions(q: Question, userId: string): { index: number; text: string }[] {
  const items = q.options.map((text, index) => ({ index, text }));
  const seed = Buffer.from(sha256(`${q.id}:${userId}`), "base64url");
  for (let i = items.length - 1; i > 0; i--) {
    const j = seed.readUInt16BE((i * 2) % (seed.length - 1)) % (i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
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

/** A student changed their name: update the lobby of any live run they're in. */
export function refreshPresentersFor(userId: string) {
  for (const lr of live.values()) if (lr.phase !== "ended" && isCheckedIn(lr.runId, userId)) lr.onCheckin();
}

export function isCheckedIn(runId: string, userId: string): boolean {
  return !!db
    .select({ id: schema.checkins.id })
    .from(schema.checkins)
    .where(and(eq(schema.checkins.runId, runId), eq(schema.checkins.userId, userId)))
    .get();
}

export type { Conn, LiveRun };
