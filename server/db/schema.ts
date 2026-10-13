import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** Name shown to the class in the lobby; asked once at first login. */
  name: text("name"),
  role: text("role", { enum: ["teacher", "student"] }).notNull().default("student"),
  createdAt: integer("created_at").notNull().default(now),
});

/** A pending email login: a 6-digit code and a link token, either one signs the user in. */
export const loginRequests = sqliteTable("login_requests", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  linkHash: text("link_hash").notNull().unique(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** A course groups tasks and holds the defaults they share. */
export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** Emails of co-teachers who can manage this course (they need a teacher account too). */
  teachers: text("teachers", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /** Defaults for its tasks: review policy and check settings. */
  defaults: text("defaults", { mode: "json" }).$type<CourseDefaults>().notNull().default(sql`'{}'`),
  createdAt: integer("created_at").notNull().default(now),
});

export type CourseDefaults = { review?: "never" | "after-session"; checks?: Partial<Record<string, string>> };

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["attendance", "quiz"] }).notNull(),
  /** What happens when an anti-cheat check fires, per check. Missing keys use the defaults in checks.ts. */
  checks: text("checks", { mode: "json" }).$type<Partial<Record<string, string>>>().notNull().default(sql`'{}'`),
  /** Whether students may revisit their answers after the session. Null: use the course default. */
  review: text("review", { enum: ["never", "after-session"] }),
  createdAt: integer("created_at").notNull().default(now),
});

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** "choice": pick an option. "open": type a short text, e.g. a question about the reading. */
    type: text("type", { enum: ["choice", "open"] }).notNull().default("choice"),
    prompt: text("prompt").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    /** Null for a poll: no right answer. */
    correctIndex: integer("correct_index"),
    /** "correct": a point for the right answer. "attempt": a point for any answer given in time. */
    scoring: text("scoring", { enum: ["correct", "attempt"] }).notNull().default("correct"),
    /** Ask students how sure they are after picking an option. */
    askConfidence: integer("ask_confidence", { mode: "boolean" }).notNull().default(false),
    timeLimitSec: integer("time_limit_sec").notNull().default(30),
  },
  (t) => [index("questions_task_idx").on(t.taskId)],
);

export type RunQuestion = typeof questions.$inferSelect;

/** One occurrence of a task in class. */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  /** The questions as they were when the run started, so editing a task never changes past results. */
  questions: text("questions", { mode: "json" }).$type<RunQuestion[]>().notNull().default(sql`'[]'`),
  startedAt: integer("started_at").notNull().default(now),
  endedAt: integer("ended_at"),
});

export const checkins = sqliteTable(
  "checkins",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Timestamp embedded in the QR code that was scanned. */
    qrIssuedAt: integer("qr_issued_at").notNull(),
    /** Server time when the scan reached us. */
    scannedAt: integer("scanned_at").notNull(),
    /** When the student finished logging in, if the scan required a login first. */
    completedAt: integer("completed_at").notNull(),
    deviceId: text("device_id").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    flags: text("flags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  },
  (t) => [uniqueIndex("checkins_run_user_idx").on(t.runId, t.userId)],
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    /** Id within the run's question snapshot; the question itself may since have been edited or removed. */
    questionId: text("question_id").notNull(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Index of the picked option; null for open questions. */
    choice: integer("choice"),
    /** Typed answer to an open question. */
    text: text("text"),
    /** How sure the student was, 0-100, when the question asked for it. */
    confidence: integer("confidence"),
    servedAt: integer("served_at").notNull(),
    answeredAt: integer("answered_at").notNull(),
    disqualified: integer("disqualified", { mode: "boolean" }).notNull().default(false),
    reason: text("reason"),
    /** Suspicious events that did not disqualify, e.g. the connection dropped mid-question. Joined with "; ". */
    flag: text("flag"),
  },
  (t) => [uniqueIndex("answers_run_q_user_idx").on(t.runId, t.questionId, t.userId)],
);
