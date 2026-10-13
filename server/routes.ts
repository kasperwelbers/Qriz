import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { type AppEnv, deviceId, emailAllowed, requireTeacher, requireUser, upsertUser, type User } from "./auth.ts";
import { canManage, questionsOf, taskFor } from "./courses.ts";
import { config } from "./config.ts";
import { randomId, seal, unseal } from "./crypto.ts";
import { db, schema } from "./db/index.ts";
import { getLiveRun } from "./live.ts";

const PENDING_JOIN_COOKIE = "pj";
const SHARED_DEVICE = "same phone as another student";
/** Device id used for students whose answers the teacher entered from paper. */
const PAPER = "paper";

type RunQuestion = schema.RunQuestion;
type AnswerRow = typeof schema.answers.$inferSelect;

/** One point per question: for the right answer, or for any answer when the question counts attempts (polls and open questions always do). */
function earnsPoint(q: RunQuestion, a: AnswerRow | null | undefined): boolean {
  if (!a || a.disqualified) return false;
  if (q.type === "open" || q.scoring === "attempt" || q.correctIndex === null) return true;
  return a.choice === q.correctIndex;
}

/** A run the current teacher may manage, through its task's course. */
function ownedRun(c: Context<AppEnv>, runId: string) {
  const row = db
    .select({ run: schema.runs, task: schema.tasks, course: schema.courses })
    .from(schema.runs)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.tasks.courseId))
    .where(eq(schema.runs.id, runId))
    .get();
  return row && canManage(c.get("user")!, row.course) ? row : null;
}

/** Whether students may revisit this task after the session: the task's own setting, else the course default, else never. */
export function reviewAllowed(task: typeof schema.tasks.$inferSelect, course: typeof schema.courses.$inferSelect): boolean {
  return (task.review ?? course.defaults.review ?? "never") === "after-session";
}

// ---------------------------------------------------------------------------
// Teacher: tasks and runs
// ---------------------------------------------------------------------------

export const teacherRoutes = new Hono<AppEnv>()
  .use(requireTeacher)

  .post("/tasks/:id/runs", (c) => {
    const row = taskFor(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const questions = questionsOf(row.task.id);
    if (row.task.kind === "quiz" && questions.length === 0) return c.json({ error: "Add at least one question first" }, 400);
    // The run keeps its own copy of the questions, so later edits don't change what was asked.
    const run = db.insert(schema.runs).values({ id: randomId(), taskId: row.task.id, questions }).returning().get();
    return c.json({ id: run.id });
  })

  /** The presenter polls this to rotate the QR code. */
  .get("/runs/:id/qr", (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const token = seal(`${row.run.id}~${Date.now()}`);
    return c.json({ url: `${config.publicUrl}/j/${token}`, rotateMs: config.qrRotateMs });
  })

  .post("/runs/:id/:action{next|close|end|paper-on|paper-off|names-on|names-off|responses-on|responses-off}", (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const lr = getLiveRun(row.run.id)!;
    const action = c.req.param("action");
    if (action === "next" && !lr.next()) return c.json({ error: "No more questions" }, 400);
    if (action === "close") lr.phase === "question" ? lr.endQuestion() : lr.close();
    if (action === "paper-on" || action === "paper-off") lr.setPaperRound(action === "paper-on");
    if (action === "names-on" || action === "names-off") lr.setShowNames(action === "names-on");
    if (action === "responses-on" || action === "responses-off") lr.setShowResponses(action === "responses-on");
    if (action === "end") lr.end();
    return c.json({ ok: true });
  })

  /** Students without a smartphone answer on paper; the teacher enters their answers here. Re-submitting overwrites. */
  .post("/runs/:id/paper-answers", async (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const body = await c.req.json<{ email?: string; answers?: (number | null)[] }>();
    const email = body.email?.trim().toLowerCase() ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !emailAllowed(email)) return c.json({ error: "Enter the student's university email address" }, 400);
    const questions = row.run.questions;
    const answers = body.answers ?? [];
    if (answers.some((a, i) => a !== null && !(questions[i]?.type === "choice" && Number.isInteger(a) && a >= 0 && a < questions[i]!.options.length)))
      return c.json({ error: "Invalid answer" }, 400);

    const user = upsertUser(email);
    const existing = db.select().from(schema.checkins).where(and(eq(schema.checkins.runId, row.run.id), eq(schema.checkins.userId, user.id))).get();
    if (existing && existing.deviceId !== PAPER) return c.json({ error: "This student already checked in with a phone" }, 400);
    const now = Date.now();
    db.transaction((tx) => {
      if (!existing)
        tx.insert(schema.checkins)
          .values({ id: randomId(), runId: row.run.id, userId: user.id, qrIssuedAt: now, scannedAt: now, completedAt: now, deviceId: PAPER, flags: [] })
          .run();
      tx.delete(schema.answers).where(and(eq(schema.answers.runId, row.run.id), eq(schema.answers.userId, user.id))).run();
      questions.forEach((q, i) => {
        const choice = answers[i];
        if (choice === null || choice === undefined) return;
        tx.insert(schema.answers).values({ id: randomId(), runId: row.run.id, questionId: q.id, userId: user.id, choice, servedAt: now, answeredAt: now }).run();
      });
    });
    getLiveRun(row.run.id)?.onCheckin();
    return c.json({ ok: true });
  })

  .get("/runs/:id/results", (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(results(row.run, row.task));
  })

  .get("/runs/:id/export.csv", (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const r = results(row.run, row.task);
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const header = [
      "email",
      "scanned_at",
      "qr_age_s",
      "login_delay_s",
      "flags",
      ...(r.questions.length ? ["score"] : []),
      ...r.questions.flatMap((q, i) => (q.askConfidence ? [`q${i + 1}`, `q${i + 1}_confidence`] : [`q${i + 1}`])),
    ];
    const lines = r.students.map((s) =>
      [
        s.email,
        new Date(s.scannedAt).toISOString(),
        ((s.scannedAt - s.qrIssuedAt) / 1000).toFixed(1),
        ((s.completedAt - s.scannedAt) / 1000).toFixed(0),
        s.suspicion.join("; "),
        ...(r.questions.length ? [s.score] : []),
        ...s.answers.flatMap((a, i) => {
          const cell = !a ? "" : `${a.choice !== null ? String.fromCharCode(65 + a.choice) : (a.text ?? "")}${a.disqualified ? " (DQ)" : ""}`;
          return r.questions[i]!.askConfidence ? [cell, a?.confidence ?? ""] : [cell];
        }),
      ]
        .map(esc)
        .join(","),
    );
    c.header("content-type", "text/csv; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${row.task.title.replace(/[^\w-]+/g, "_")}-${row.run.id}.csv"`);
    return c.body([header.map(esc).join(","), ...lines].join("\n"));
  });

function results(run: typeof schema.runs.$inferSelect, task: typeof schema.tasks.$inferSelect) {
  const questions = run.questions;
  const checkins = db
    .select({ checkin: schema.checkins, email: schema.users.email })
    .from(schema.checkins)
    .innerJoin(schema.users, eq(schema.users.id, schema.checkins.userId))
    .where(eq(schema.checkins.runId, run.id))
    .orderBy(asc(schema.checkins.scannedAt))
    .all();
  const answers = db.select().from(schema.answers).where(eq(schema.answers.runId, run.id)).all();
  const suspicion = new Map<string, string[]>(checkins.map(({ checkin }) => [checkin.userId, [...checkin.flags]]));

  // Network: flag check-ins from outside the network most of the room is on. Weak signal (mobile data is common).
  const net = (ip: string | null) => (ip ? (ip.includes(":") ? ip.split(":").slice(0, 3).join(":") : ip.split(".").slice(0, 2).join(".")) : null);
  const nets = new Map<string, number>();
  for (const { checkin } of checkins) {
    const n = net(checkin.ip);
    if (n) nets.set(n, (nets.get(n) ?? 0) + 1);
  }
  const [mainNet, mainCount] = [...nets].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (mainNet && checkins.length >= 5 && mainCount / checkins.length >= 0.5) {
    for (const { checkin } of checkins) if (checkin.ip && net(checkin.ip) !== mainNet) suspicion.get(checkin.userId)!.push("different network");
  }

  for (const a of answers) if (a.flag) suspicion.get(a.userId)?.push(`${a.flag} on Q${questions.findIndex((q) => q.id === a.questionId) + 1}`);

  return {
    run,
    task,
    questions,
    students: checkins.map(({ checkin, email }) => {
      const mine = questions.map((q) => answers.find((a) => a.userId === checkin.userId && a.questionId === q.id) ?? null);
      return {
        userId: checkin.userId,
        email,
        scannedAt: checkin.scannedAt,
        qrIssuedAt: checkin.qrIssuedAt,
        completedAt: checkin.completedAt,
        ip: checkin.ip,
        paper: checkin.deviceId === PAPER,
        suspicion: [...new Set(suspicion.get(checkin.userId))],
        score: questions.filter((q, i) => earnsPoint(q, mine[i])).length,
        answers: mine.map(
          (a) => a && { choice: a.choice, text: a.text, confidence: a.confidence, disqualified: a.disqualified, reason: a.reason, flag: a.flag, ms: a.answeredAt - a.servedAt },
        ),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Students: joining a run by scanning the QR code
// ---------------------------------------------------------------------------

function parseQrToken(token: string): { runId: string; issuedAt: number } | null {
  const payload = unseal(token);
  if (!payload) return null;
  const [runId, ts] = payload.split("~");
  const issuedAt = Number(ts);
  return runId && Number.isFinite(issuedAt) ? { runId, issuedAt } : null;
}

function checkin(c: Context<AppEnv>, user: User, runId: string, qrIssuedAt: number, scannedAt: number) {
  const did = deviceId(c);
  const existing = db.select().from(schema.checkins).where(and(eq(schema.checkins.runId, runId), eq(schema.checkins.userId, user.id))).get();
  if (existing) return existing;

  const flags: string[] = [];
  const now = Date.now();
  if (scannedAt - qrIssuedAt > config.qrSlowScanMs) flags.push(`slow scan (${((scannedAt - qrIssuedAt) / 1000).toFixed(1)} s)`);
  if (now - scannedAt > 2 * 60_000) flags.push(`login took ${Math.round((now - scannedAt) / 60_000)} min`);
  const sameDevice = db
    .select()
    .from(schema.checkins)
    .where(and(eq(schema.checkins.runId, runId), eq(schema.checkins.deviceId, did), ne(schema.checkins.userId, user.id)))
    .all();
  if (sameDevice.length) {
    flags.push(SHARED_DEVICE);
    for (const other of sameDevice) {
      if (!other.flags.includes(SHARED_DEVICE))
        db.update(schema.checkins).set({ flags: [...other.flags, SHARED_DEVICE] }).where(eq(schema.checkins.id, other.id)).run();
    }
  }
  const row = db
    .insert(schema.checkins)
    .values({
      id: randomId(),
      runId,
      userId: user.id,
      qrIssuedAt,
      scannedAt,
      completedAt: now,
      deviceId: did,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: c.req.header("user-agent")?.slice(0, 300),
      flags,
    })
    .returning()
    .get();
  getLiveRun(runId)?.onCheckin();
  return row;
}

function openRun(runId: string) {
  const row = db
    .select({ run: schema.runs, task: schema.tasks })
    .from(schema.runs)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
    .where(eq(schema.runs.id, runId))
    .get();
  return row && row.run.endedAt === null ? row : null;
}

export const joinRoutes = new Hono<AppEnv>()
  .post("/join", async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    const parsed = parseQrToken(String(token));
    const now = Date.now();
    if (!parsed) return c.json({ error: "This QR code is not valid." }, 400);
    const age = now - parsed.issuedAt;
    if (age > config.qrMaxAgeMs || age < -2000) return c.json({ error: "This QR code has expired. Scan the code on the screen again." }, 400);
    const row = openRun(parsed.runId);
    if (!row) return c.json({ error: "This session has ended." }, 400);

    const user = c.get("user");
    if (!user) {
      // Remember the valid scan so the student can log in first without the code expiring.
      setCookie(c, PENDING_JOIN_COOKIE, seal(`${parsed.runId}~${parsed.issuedAt}~${now}`), {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.publicUrl.startsWith("https://"),
        path: "/",
        maxAge: Math.floor(config.pendingJoinMs / 1000),
      });
      return c.json({ needLogin: true, title: row.task.title });
    }
    checkin(c, user, parsed.runId, parsed.issuedAt, now);
    return c.json({ runId: parsed.runId, kind: row.task.kind, title: row.task.title });
  })

  .post("/join/resume", requireUser, (c) => {
    const sealed = getCookie(c, PENDING_JOIN_COOKIE);
    const payload = sealed && unseal(sealed);
    deleteCookie(c, PENDING_JOIN_COOKIE, { path: "/" });
    if (!payload) return c.json({ error: "Scan the QR code on the screen again." }, 400);
    const [runId, issuedAt, scannedAt] = payload.split("~");
    if (Date.now() - Number(scannedAt) > config.pendingJoinMs) return c.json({ error: "That took too long. Scan the QR code again." }, 400);
    const row = openRun(runId!);
    if (!row) return c.json({ error: "This session has ended." }, 400);
    checkin(c, c.get("user")!, runId!, Number(issuedAt), Number(scannedAt));
    return c.json({ runId, kind: row.task.kind, title: row.task.title });
  });

// ---------------------------------------------------------------------------
// Students: their own participation history
// ---------------------------------------------------------------------------

export const studentRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/history", (c) => {
    const userId = c.get("user")!.id;
    const rows = db
      .select({ run: schema.runs, task: schema.tasks, course: schema.courses, checkin: schema.checkins })
      .from(schema.checkins)
      .innerJoin(schema.runs, eq(schema.runs.id, schema.checkins.runId))
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.tasks.courseId))
      .where(eq(schema.checkins.userId, userId))
      .orderBy(desc(schema.runs.startedAt))
      .all();
    const runIds = rows.map((r) => r.run.id);
    const answers = runIds.length
      ? db.select().from(schema.answers).where(and(inArray(schema.answers.runId, runIds), eq(schema.answers.userId, userId))).all()
      : [];
    return c.json(
      rows.map(({ run, task, course, checkin }) => {
        const mine = answers.filter((a) => a.runId === run.id);
        return {
          runId: run.id,
          title: task.title,
          course: course.title,
          kind: task.kind,
          startedAt: run.startedAt,
          checkedInAt: checkin.scannedAt,
          questions: run.questions.length,
          answered: mine.length,
          notCounted: mine.filter((a) => a.disqualified).length,
          typed: mine.filter((a) => a.text).length,
          canReview: run.endedAt !== null && run.questions.length > 0 && reviewAllowed(task, course),
        };
      }),
    );
  })

  /** A finished session's questions with this student's own answers, if the teacher allows review. Also used for practice. */
  .get("/runs/:id/review", (c) => {
    const userId = c.get("user")!.id;
    const row = db
      .select({ run: schema.runs, task: schema.tasks, course: schema.courses })
      .from(schema.checkins)
      .innerJoin(schema.runs, eq(schema.runs.id, schema.checkins.runId))
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.tasks.courseId))
      .where(and(eq(schema.checkins.runId, c.req.param("id")), eq(schema.checkins.userId, userId)))
      .get();
    if (!row || row.run.endedAt === null || !reviewAllowed(row.task, row.course)) return c.json({ error: "This session can't be reviewed." }, 403);
    const answers = db.select().from(schema.answers).where(and(eq(schema.answers.runId, row.run.id), eq(schema.answers.userId, userId))).all();
    return c.json({
      title: row.task.title,
      course: row.course.title,
      startedAt: row.run.startedAt,
      questions: row.run.questions.map((q) => {
        const a = answers.find((x) => x.questionId === q.id);
        return {
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correctIndex: q.correctIndex,
          mine: a ? { choice: a.choice, text: a.text, confidence: a.confidence, counted: !a.disqualified } : null,
        };
      }),
    });
  });
