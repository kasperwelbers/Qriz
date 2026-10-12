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

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["attendance", "quiz"] }).notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    prompt: text("prompt").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    correctIndex: integer("correct_index"),
    timeLimitSec: integer("time_limit_sec").notNull().default(30),
  },
  (t) => [index("questions_task_idx").on(t.taskId)],
);

/** One occurrence of a task in class. */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
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
    questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    choice: integer("choice").notNull(),
    servedAt: integer("served_at").notNull(),
    answeredAt: integer("answered_at").notNull(),
    disqualified: integer("disqualified", { mode: "boolean" }).notNull().default(false),
    reason: text("reason"),
    /** A suspicious event that does not disqualify, e.g. the connection dropped mid-question. */
    flag: text("flag"),
  },
  (t) => [uniqueIndex("answers_run_q_user_idx").on(t.runId, t.questionId, t.userId)],
);
