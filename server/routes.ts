import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { type AppEnv, deviceId, emailAllowed, requireTeacher, requireUser, upsertUser, type User } from "./auth.ts";
import { config } from "./config.ts";
import { randomId, seal, unseal } from "./crypto.ts";
import { db, schema } from "./db/index.ts";
import { getLiveRun } from "./live.ts";

const PENDING_JOIN_COOKIE = "pj";
const SHARED_DEVICE = "same phone as another student";
/** Device id used for students whose answers the teacher entered from paper. */
const PAPER = "paper";

type QuestionInput = { id?: string; prompt: string; options: string[]; correctIndex: number | null; timeLimitSec: number };
type TaskInput = { title: string; kind: "attendance" | "quiz"; questions?: QuestionInput[] };

function validateTask(body: TaskInput): string | null {
  if (!body.title?.trim()) return "Title is required";
  if (body.kind !== "attendance" && body.kind !== "quiz") return "Invalid kind";
  for (const q of body.questions ?? []) {
    if (!q.prompt?.trim()) return "Every question needs a prompt";
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return "Questions need 2 to 6 options";
    if (q.correctIndex !== null && (q.correctIndex < 0 || q.correctIndex >= q.options.length)) return "Invalid correct answer";
    if (!(q.timeLimitSec >= 5 && q.timeLimitSec <= 600)) return "Time limit must be 5 to 600 seconds";
  }
  return null;
}

function saveQuestions(taskId: string, input: QuestionInput[]) {
  const existing = db.select({ id: schema.questions.id }).from(schema.questions).where(eq(schema.questions.taskId, taskId)).all();
  const keep = new Set(input.map((q) => q.id).filter(Boolean));
  const removed = existing.map((q) => q.id).filter((id) => !keep.has(id));
  if (removed.length) db.delete(schema.questions).where(inArray(schema.questions.id, removed)).run();
  input.forEach((q, position) => {
    const values = { prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()), correctIndex: q.correctIndex, timeLimitSec: Math.round(q.timeLimitSec), position };
    if (q.id && existing.some((e) => e.id === q.id)) db.update(schema.questions).set(values).where(eq(schema.questions.id, q.id)).run();
    else db.insert(schema.questions).values({ id: randomId(), taskId, ...values }).run();
  });
}

function ownedTask(c: Context<AppEnv>, taskId: string) {
  return db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.ownerId, c.get("user")!.id)))
    .get();
}

function ownedRun(c: Context<AppEnv>, runId: string) {
  const row = db
    .select({ run: schema.runs, task: schema.tasks })
    .from(schema.runs)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.runs.taskId))
    .where(and(eq(schema.runs.id, runId), eq(schema.tasks.ownerId, c.get("user")!.id)))
    .get();
  return row ?? null;
}

const getQuestions = (taskId: string) =>
  db.select().from(schema.questions).where(eq(schema.questions.taskId, taskId)).orderBy(asc(schema.questions.position)).all();

// ---------------------------------------------------------------------------
// Teacher: tasks and runs
// ---------------------------------------------------------------------------

export const teacherRoutes = new Hono<AppEnv>()
  .use(requireTeacher)

  .get("/tasks", (c) => {
    const tasks = db.select().from(schema.tasks).where(eq(schema.tasks.ownerId, c.get("user")!.id)).orderBy(desc(schema.tasks.createdAt)).all();
    const runs = tasks.length
      ? db.select().from(schema.runs).where(inArray(schema.runs.taskId, tasks.map((t) => t.id))).orderBy(desc(schema.runs.startedAt)).all()
      : [];
    return c.json(tasks.map((t) => ({ ...t, runs: runs.filter((r) => r.taskId === t.id) })));
  })

  .post("/tasks", async (c) => {
    const body = await c.req.json<TaskInput>();
    const error = validateTask(body);
    if (error) return c.json({ error }, 400);
    const task = db.insert(schema.tasks).values({ id: randomId(), ownerId: c.get("user")!.id, title: body.title.trim(), kind: body.kind }).returning().get();
    saveQuestions(task.id, body.kind === "quiz" ? (body.questions ?? []) : []);
    return c.json(task);
  })

  .get("/tasks/:id", (c) => {
    const task = ownedTask(c, c.req.param("id"));
    if (!task) return c.json({ error: "Not found" }, 404);
    return c.json({ ...task, questions: getQuestions(task.id) });
  })

  .put("/tasks/:id", async (c) => {
    const task = ownedTask(c, c.req.param("id"));
    if (!task) return c.json({ error: "Not found" }, 404);
    const body = await c.req.json<TaskInput>();
    const error = validateTask(body);
    if (error) return c.json({ error }, 400);
    db.update(schema.tasks).set({ title: body.title.trim(), kind: body.kind }).where(eq(schema.tasks.id, task.id)).run();
    saveQuestions(task.id, body.kind === "quiz" ? (body.questions ?? []) : []);
    return c.json({ ok: true });
  })

  .delete("/tasks/:id", (c) => {
    const task = ownedTask(c, c.req.param("id"));
    if (!task) return c.json({ error: "Not found" }, 404);
    db.delete(schema.tasks).where(eq(schema.tasks.id, task.id)).run();
    return c.json({ ok: true });
  })

  .post("/tasks/:id/runs", (c) => {
    const task = ownedTask(c, c.req.param("id"));
    if (!task) return c.json({ error: "Not found" }, 404);
    if (task.kind === "quiz" && getQuestions(task.id).length === 0) return c.json({ error: "Add at least one question first" }, 400);
    const run = db.insert(schema.runs).values({ id: randomId(), taskId: task.id }).returning().get();
    return c.json(run);
  })

  /** The presenter polls this to rotate the QR code. */
  .get("/runs/:id/qr", (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const token = seal(`${row.run.id}~${Date.now()}`);
    return c.json({ url: `${config.publicUrl}/j/${token}`, rotateMs: config.qrRotateMs });
  })

  .post("/runs/:id/:action{next|close|end|paper-on|paper-off}", (c) => {
    const row = ownedRun(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const lr = getLiveRun(row.run.id)!;
    const action = c.req.param("action");
    if (action === "next" && !lr.next()) return c.json({ error: "No more questions" }, 400);
    if (action === "close") lr.phase === "question" ? lr.endQuestion() : lr.close();
    if (action === "paper-on" || action === "paper-off") lr.setPaperRound(action === "paper-on");
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
    const questions = getQuestions(row.task.id);
    const answers = body.answers ?? [];
    if (answers.some((a, i) => a !== null && !(Number.isInteger(a) && a >= 0 && a < (questions[i]?.options.length ?? 0))))
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
    const header = ["email", "scanned_at", "qr_age_s", "login_delay_s", "flags", ...(r.questions.length ? ["score"] : []), ...r.questions.map((_, i) => `q${i + 1}`)];
    const lines = r.students.map((s) =>
      [
        s.email,
        new Date(s.scannedAt).toISOString(),
        ((s.scannedAt - s.qrIssuedAt) / 1000).toFixed(1),
        ((s.completedAt - s.scannedAt) / 1000).toFixed(0),
        s.suspicion.join("; "),
        ...(r.questions.length ? [s.score] : []),
        ...s.answers.map((a) => (a ? `${String.fromCharCode(65 + a.choice)}${a.disqualified ? " (DQ)" : ""}` : "")),
      ]
        .map(esc)
        .join(","),
    );
    c.header("content-type", "text/csv; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${row.task.title.replace(/[^\w-]+/g, "_")}-${row.run.id}.csv"`);
    return c.body([header.map(esc).join(","), ...lines].join("\n"));
  });

function results(run: typeof schema.runs.$inferSelect, task: typeof schema.tasks.$inferSelect) {
  const questions = getQuestions(task.id);
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

  // Answer sharing: two students repeatedly giving the same answer within seconds, including a shared wrong one.
  const byUser = new Map<string, Map<string, (typeof answers)[number]>>();
  const paperUsers = new Set(checkins.filter(({ checkin }) => checkin.deviceId === PAPER).map(({ checkin }) => checkin.userId));
  for (const a of answers) {
    if (a.disqualified || paperUsers.has(a.userId)) continue;
    if (!byUser.has(a.userId)) byUser.set(a.userId, new Map());
    byUser.get(a.userId)!.set(a.questionId, a);
  }
  const emailOf = new Map(checkins.map(({ checkin, email }) => [checkin.userId, email]));
  const users = [...byUser.keys()];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      let together = 0;
      let wrongTogether = 0;
      for (const q of questions) {
        const a = byUser.get(users[i]!)!.get(q.id);
        const b = byUser.get(users[j]!)!.get(q.id);
        if (a && b && a.choice === b.choice && Math.abs(a.answeredAt - b.answeredAt) <= 2000) {
          together++;
          if (q.correctIndex !== null && a.choice !== q.correctIndex) wrongTogether++;
        }
      }
      if (together >= 2 && wrongTogether >= 1) {
        suspicion.get(users[i]!)?.push(`answers in sync with ${emailOf.get(users[j]!)}`);
        suspicion.get(users[j]!)?.push(`answers in sync with ${emailOf.get(users[i]!)}`);
      }
    }
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
        score: mine.filter((a, i) => a && !a.disqualified && a.choice === questions[i]!.correctIndex).length,
        answers: mine.map((a) => a && { choice: a.choice, disqualified: a.disqualified, reason: a.reason, flag: a.flag, ms: a.answeredAt - a.servedAt }),
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
