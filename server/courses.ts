import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { CourseSpec, type TaskData, TaskSpec, taskFromSpec, taskToSpec } from "../shared/spec.ts";
import { type AppEnv, requireTeacher, type User } from "./auth.ts";
import { randomId } from "./crypto.ts";
import { db, schema } from "./db/index.ts";

type Course = typeof schema.courses.$inferSelect;
type Task = typeof schema.tasks.$inferSelect;

export function canManage(user: User, course: Course): boolean {
  return course.ownerId === user.id || course.teachers.includes(user.email);
}

function courseFor(c: Context<AppEnv>, id: string): Course | null {
  const course = db.select().from(schema.courses).where(eq(schema.courses.id, id)).get();
  return course && canManage(c.get("user")!, course) ? course : null;
}

/** A task the current teacher may manage, with its course. */
export function taskFor(c: Context<AppEnv>, id: string): { task: Task; course: Course } | null {
  const row = db
    .select({ task: schema.tasks, course: schema.courses })
    .from(schema.tasks)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.tasks.courseId))
    .where(eq(schema.tasks.id, id))
    .get();
  return row && canManage(c.get("user")!, row.course) ? row : null;
}

export const questionsOf = (taskId: string) =>
  db.select().from(schema.questions).where(eq(schema.questions.taskId, taskId)).orderBy(asc(schema.questions.position)).all();

function taskData(task: Task): TaskData {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    review: task.review,
    checks: task.checks,
    questions: questionsOf(task.id).map(({ type, prompt, options, correctIndex, scoring, askConfidence, timeLimitSec }) => ({
      type,
      prompt,
      options,
      correctIndex,
      scoring,
      askConfidence,
      timeLimitSec,
    })),
  };
}

/** Validates form input with the same schema as the YAML editor, so both give the same errors. */
function parseTaskData(body: TaskData): { data: TaskData; error: null } | { data: null; error: string } {
  const result = TaskSpec.safeParse(taskToSpec({ ...body, questions: body.kind === "quiz" ? (body.questions ?? []) : [] }));
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const where = issue.path
      .map((p, i) => (typeof p === "number" ? `${issue.path[i - 1] === "questions" ? "Question" : "Item"} ${p + 1}` : p === "questions" ? null : p))
      .filter(Boolean)
      .join(" › ");
    return { data: null, error: where ? `${where}: ${issue.message}` : issue.message };
  }
  return { data: taskFromSpec(result.data), error: null };
}

/** Writes a task and replaces its questions. Past runs keep their own snapshot, so replacing is safe. */
function saveTask(courseId: string, ownerId: string, data: TaskData, opts: { id?: string; position: number }): string {
  const id = opts.id ?? randomId();
  const values = { title: data.title, kind: data.kind, review: data.review, checks: data.checks ?? {}, position: opts.position };
  if (opts.id) db.update(schema.tasks).set(values).where(eq(schema.tasks.id, id)).run();
  else db.insert(schema.tasks).values({ id, courseId, ownerId, ...values }).run();
  db.delete(schema.questions).where(eq(schema.questions.taskId, id)).run();
  data.questions.forEach((q, position) => db.insert(schema.questions).values({ ...q, id: randomId(), taskId: id, position }).run());
  return id;
}

function nextPosition(courseId: string): number {
  const last = db.select({ p: schema.tasks.position }).from(schema.tasks).where(eq(schema.tasks.courseId, courseId)).orderBy(desc(schema.tasks.position)).get();
  return (last?.p ?? -1) + 1;
}

function courseSpec(course: Course): CourseSpec {
  const tasks = db.select().from(schema.tasks).where(eq(schema.tasks.courseId, course.id)).orderBy(asc(schema.tasks.position)).all();
  const spec: CourseSpec = { course: course.title };
  if (course.teachers.length) spec.teachers = course.teachers;
  if (Object.keys(course.defaults).length) spec.defaults = course.defaults as CourseSpec["defaults"];
  spec.tasks = tasks.map((t) => taskToSpec(taskData(t)));
  return spec;
}

export const courseRoutes = new Hono<AppEnv>()
  .use(requireTeacher)

  .get("/courses", (c) => {
    const user = c.get("user")!;
    const courses = db.select().from(schema.courses).orderBy(desc(schema.courses.createdAt)).all().filter((co) => canManage(user, co));
    const tasks = courses.length ? db.select({ courseId: schema.tasks.courseId }).from(schema.tasks).where(inArray(schema.tasks.courseId, courses.map((co) => co.id))).all() : [];
    return c.json(courses.map((co) => ({ ...co, taskCount: tasks.filter((t) => t.courseId === co.id).length, shared: co.ownerId !== user.id })));
  })

  .post("/courses", async (c) => {
    const { title } = await c.req.json<{ title?: string }>();
    if (!title?.trim()) return c.json({ error: "Give the course a title" }, 400);
    const course = db.insert(schema.courses).values({ id: randomId(), ownerId: c.get("user")!.id, title: title.trim() }).returning().get();
    return c.json(course);
  })

  .get("/courses/:id", (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    const tasks = db.select().from(schema.tasks).where(eq(schema.tasks.courseId, course.id)).orderBy(asc(schema.tasks.position)).all();
    const runs = tasks.length
      ? db
          .select({ id: schema.runs.id, taskId: schema.runs.taskId, startedAt: schema.runs.startedAt, endedAt: schema.runs.endedAt })
          .from(schema.runs)
          .where(inArray(schema.runs.taskId, tasks.map((t) => t.id)))
          .orderBy(desc(schema.runs.startedAt))
          .all()
      : [];
    const counts = tasks.length
      ? db.select({ taskId: schema.questions.taskId }).from(schema.questions).where(inArray(schema.questions.taskId, tasks.map((t) => t.id))).all()
      : [];
    return c.json({
      ...course,
      isOwner: course.ownerId === c.get("user")!.id,
      tasks: tasks.map((t) => ({ ...t, questionCount: counts.filter((q) => q.taskId === t.id).length, runs: runs.filter((r) => r.taskId === t.id) })),
    });
  })

  .put("/courses/:id", async (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    const body = await c.req.json<{ title: string; teachers?: string[]; defaults?: unknown }>();
    const parsed = CourseSpec.safeParse({ course: body.title, teachers: body.teachers, defaults: body.defaults });
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]!.message }, 400);
    db.update(schema.courses)
      .set({ title: parsed.data.course, teachers: parsed.data.teachers ?? [], defaults: parsed.data.defaults ?? {} })
      .where(eq(schema.courses.id, course.id))
      .run();
    return c.json({ ok: true });
  })

  .delete("/courses/:id", (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    if (course.ownerId !== c.get("user")!.id) return c.json({ error: "Only the course owner can delete it" }, 403);
    db.delete(schema.courses).where(eq(schema.courses.id, course.id)).run();
    return c.json({ ok: true });
  })

  /** A copy with all tasks and questions, without any results. Handy for next year. */
  .post("/courses/:id/duplicate", (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    const user = c.get("user")!;
    const id = randomId();
    db.transaction(() => {
      db.insert(schema.courses).values({ id, ownerId: user.id, title: `${course.title} (copy)`, teachers: course.teachers, defaults: course.defaults }).run();
      const tasks = db.select().from(schema.tasks).where(eq(schema.tasks.courseId, course.id)).orderBy(asc(schema.tasks.position)).all();
      for (const t of tasks) saveTask(id, user.id, { ...taskData(t), id: undefined }, { position: t.position });
    });
    return c.json({ id });
  })

  .get("/courses/:id/spec", (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    return c.json(courseSpec(course));
  })

  /** Applies a whole-course edit from the YAML editor: tasks are matched by id, new ones are created. */
  .put("/courses/:id/spec", async (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    const parsed = CourseSpec.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]!.message }, 400);
    const spec = parsed.data;
    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.courseId, course.id)).all();
    const byId = new Map(existing.map((t) => [t.id, t]));
    const unknown = spec.tasks.findIndex((t) => t.id && !byId.has(t.id));
    if (unknown >= 0) return c.json({ error: `Task ${unknown + 1} "${spec.tasks[unknown]!.title}" has an id that isn't in this course. Remove its id line to add it as a new task.` }, 400);
    const kept = new Set(spec.tasks.map((t) => t.id).filter(Boolean));
    const removed = existing.filter((t) => !kept.has(t.id));
    const withRuns = removed.length
      ? new Set(db.select({ taskId: schema.runs.taskId }).from(schema.runs).where(inArray(schema.runs.taskId, removed.map((t) => t.id))).all().map((r) => r.taskId))
      : new Set<string>();
    const blocked = removed.filter((t) => withRuns.has(t.id));
    if (blocked.length)
      return c.json(
        { error: `${blocked.map((t) => `"${t.title}"`).join(", ")} ${blocked.length === 1 ? "has" : "have"} results, so ${blocked.length === 1 ? "it" : "they"} can't be removed here. Delete from the course page if you're sure.` },
        400,
      );
    const user = c.get("user")!;
    db.transaction(() => {
      db.update(schema.courses)
        .set({ title: spec.course, teachers: spec.teachers ?? [], defaults: spec.defaults ?? {} })
        .where(eq(schema.courses.id, course.id))
        .run();
      for (const t of removed) db.delete(schema.tasks).where(eq(schema.tasks.id, t.id)).run();
      spec.tasks.forEach((t, position) => saveTask(course.id, user.id, taskFromSpec(t), { id: t.id, position }));
    });
    return c.json(courseSpec(db.select().from(schema.courses).where(eq(schema.courses.id, course.id)).get()!));
  })

  .post("/courses/:id/tasks", async (c) => {
    const course = courseFor(c, c.req.param("id"));
    if (!course) return c.json({ error: "Not found" }, 404);
    const { data, error } = parseTaskData(await c.req.json<TaskData>());
    if (!data) return c.json({ error }, 400);
    const id = saveTask(course.id, c.get("user")!.id, data, { position: nextPosition(course.id) });
    return c.json({ id });
  })

  .get("/tasks/:id", (c) => {
    const row = taskFor(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ ...taskData(row.task), course: { id: row.course.id, title: row.course.title, defaults: row.course.defaults } });
  })

  .put("/tasks/:id", async (c) => {
    const row = taskFor(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const { data, error } = parseTaskData(await c.req.json<TaskData>());
    if (!data) return c.json({ error }, 400);
    db.transaction(() => saveTask(row.course.id, row.task.ownerId, data, { id: row.task.id, position: row.task.position }));
    return c.json({ ok: true });
  })

  .delete("/tasks/:id", (c) => {
    const row = taskFor(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    db.delete(schema.tasks).where(eq(schema.tasks.id, row.task.id)).run();
    return c.json({ ok: true });
  })

  /** Copies a task into the same course, right after the original. */
  .post("/tasks/:id/duplicate", (c) => {
    const row = taskFor(c, c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const data = taskData(row.task);
    const id = db.transaction(() => {
      db.update(schema.tasks)
        .set({ position: sql`${schema.tasks.position} + 1` })
        .where(and(eq(schema.tasks.courseId, row.course.id), gt(schema.tasks.position, row.task.position)))
        .run();
      return saveTask(row.course.id, c.get("user")!.id, { ...data, id: undefined, title: `${data.title} (copy)` }, { position: row.task.position + 1 });
    });
    return c.json({ id });
  });

