/**
 * The editable format of courses and tasks, used by the YAML editor, the form editor and the server.
 * One Zod schema validates all three, so errors read the same everywhere.
 */
import { Document, isMap, isPair, isScalar, isSeq, LineCounter, parseDocument, visit } from "yaml";
import { z } from "zod";

export const CHECK_ACTIONS = ["disqualify", "warn", "record"] as const;
export const REVIEW = ["never", "after-session"] as const;
const LETTERS = "ABCDEF";

const action = z.enum(CHECK_ACTIONS);
const Checks = z
  .strictObject({
    leftPage: action.optional().meta({ description: "Switching apps or tabs during a question" }),
    splitScreen: action.optional().meta({ description: "Using the quiz next to another app" }),
    connectionLost: action.optional().meta({ description: "The phone dropped offline during a question" }),
  })
  .meta({ description: "What happens when a check fires: disqualify (answer doesn't count), warn (counts, student sees a warning) or record (only the teacher sees it)" });

export const QuestionSpec = z
  .strictObject({
    q: z.string().trim().min(1, "Write the question").meta({ description: "The question, shown on the projector only" }),
    options: z
      .array(z.string().trim().min(1, "An option can't be empty"))
      .min(2, "Give at least 2 options")
      .max(6, "Give at most 6 options")
      .optional()
      .meta({ description: "2 to 6 answer options. Leave out for an open question" }),
    correct: z
      .union([z.string(), z.number()])
      .optional()
      .meta({ description: "The right option: its text or its letter (A, B, ...). Leave out for a poll" }),
    open: z.boolean().optional().meta({ description: "true: students type an answer instead of picking an option" }),
    points: z
      .enum(["correct", "attempt"])
      .optional()
      .meta({ description: "correct (default): a point for the right answer. attempt: a point for any answer in time" }),
    confidence: z.boolean().optional().meta({ description: "true: ask students how sure they are" }),
    seconds: z.number().int().min(5, "At least 5 seconds").max(600, "At most 600 seconds").optional().meta({ description: "Time limit, default 30" }),
  })
  .superRefine((q, ctx) => {
    if (q.open) {
      if (q.options) ctx.addIssue({ code: "custom", path: ["options"], message: "An open question has no options. Remove them, or remove open: true" });
      if (q.correct !== undefined) ctx.addIssue({ code: "custom", path: ["correct"], message: "An open question has no correct answer" });
      return;
    }
    if (!q.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add options (2 to 6), or set open: true for a typed answer" });
      return;
    }
    if (q.correct !== undefined && correctIndexOf(q.options, q.correct) === null)
      ctx.addIssue({ code: "custom", path: ["correct"], message: `Must be one of the options, or its letter (${LETTERS.slice(0, q.options.length).split("").join(", ")})` });
    if (q.points === "correct" && q.correct === undefined)
      ctx.addIssue({ code: "custom", path: ["points"], message: "points: correct needs a correct answer. Add correct, or use points: attempt" });
  });

export const TaskSpec = z
  .strictObject({
    id: z.string().optional().meta({ description: "Links this task to its saved results. Don't change it; remove it on a copy" }),
    title: z.string().trim().min(1, "Give the task a title"),
    kind: z.enum(["quiz", "attendance"]).optional().meta({ description: "Default: quiz when there are questions, attendance otherwise" }),
    review: z.enum(REVIEW).optional().meta({ description: "Whether students can revisit their answers after the session. Default: the course setting" }),
    checks: Checks.optional(),
    questions: z.array(QuestionSpec).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.kind === "quiz" && !t.questions?.length) ctx.addIssue({ code: "custom", path: ["questions"], message: "A quiz needs at least one question" });
    if (t.kind === "attendance" && t.questions?.length) ctx.addIssue({ code: "custom", path: ["kind"], message: "An attendance task has no questions. Remove them, or use kind: quiz" });
  });

export const CourseSpec = z
  .strictObject({
    course: z.string().trim().min(1, "Give the course a title").meta({ description: "Course title" }),
    teachers: z.array(z.email("Not a valid email address")).optional().meta({ description: "Co-teachers who can also manage this course" }),
    defaults: z
      .strictObject({
        review: z.enum(REVIEW).optional().meta({ description: "Default for all tasks; never unless you choose otherwise" }),
        checks: Checks.optional(),
      })
      .optional(),
    tasks: z.array(TaskSpec).default([]),
  })
  .superRefine((c, ctx) => {
    const seen = new Map<string, number>();
    c.tasks.forEach((t, i) => {
      if (!t.id) return;
      if (seen.has(t.id))
        ctx.addIssue({ code: "custom", path: ["tasks", i, "id"], message: `Same id as task ${seen.get(t.id)! + 1}. Remove the id line from the copy` });
      else seen.set(t.id, i);
    });
  });

export type QuestionSpec = z.input<typeof QuestionSpec>;
export type TaskSpec = z.input<typeof TaskSpec>;
export type CourseSpec = z.input<typeof CourseSpec>;
export type CheckSettingsSpec = z.infer<typeof Checks>;

/** The question shape used by the form editor and the API. */
export type QuestionData = {
  id?: string;
  type: "choice" | "open";
  prompt: string;
  options: string[];
  correctIndex: number | null;
  scoring: "correct" | "attempt";
  askConfidence: boolean;
  timeLimitSec: number;
};

export type TaskData = {
  id?: string;
  title: string;
  kind: "quiz" | "attendance";
  review: (typeof REVIEW)[number] | null;
  checks: CheckSettingsSpec;
  questions: QuestionData[];
};

export function correctIndexOf(options: string[], correct: string | number): number | null {
  if (typeof correct === "number") return Number.isInteger(correct) && correct >= 0 && correct < options.length ? correct : null;
  const text = correct.trim();
  const exact = options.findIndex((o) => o.trim() === text);
  if (exact >= 0) return exact;
  const letter = LETTERS.indexOf(text.toUpperCase());
  return text.length === 1 && letter >= 0 && letter < options.length ? letter : null;
}

export function questionFromSpec(q: QuestionSpec): QuestionData {
  const open = !!q.open;
  const correctIndex = open || q.correct === undefined ? null : correctIndexOf(q.options ?? [], q.correct);
  return {
    type: open ? "open" : "choice",
    prompt: q.q.trim(),
    options: open ? [] : (q.options ?? []).map((o) => o.trim()),
    correctIndex,
    scoring: correctIndex === null || q.points === "attempt" ? "attempt" : "correct",
    askConfidence: !open && !!q.confidence,
    timeLimitSec: q.seconds ?? 30,
  };
}

export function questionToSpec(q: QuestionData): QuestionSpec {
  const out: QuestionSpec = { q: q.prompt };
  if (q.type === "open") out.open = true;
  else {
    out.options = q.options;
    if (q.correctIndex !== null && q.options[q.correctIndex] !== undefined) out.correct = q.options[q.correctIndex];
    if (q.correctIndex !== null && q.scoring === "attempt") out.points = "attempt";
    if (q.askConfidence) out.confidence = true;
  }
  if (q.timeLimitSec !== 30) out.seconds = q.timeLimitSec;
  return out;
}

export function taskFromSpec(t: TaskSpec): TaskData {
  const questions = (t.questions ?? []).map(questionFromSpec);
  return {
    id: t.id,
    title: t.title.trim(),
    kind: t.kind ?? (questions.length ? "quiz" : "attendance"),
    review: t.review ?? null,
    checks: t.checks ?? {},
    questions,
  };
}

export function taskToSpec(t: TaskData, withId = true): TaskSpec {
  const out = {} as TaskSpec;
  if (withId && t.id) out.id = t.id;
  out.title = t.title;
  if (t.kind === "attendance") out.kind = "attendance";
  if (t.review) out.review = t.review;
  if (Object.keys(t.checks ?? {}).length) out.checks = t.checks;
  if (t.kind === "quiz") out.questions = t.questions.map(questionToSpec);
  return out as TaskSpec;
}

/** YAML with option lists on one line, which is easier to scan and edit. */
export function toYaml(value: unknown): string {
  const doc = new Document(value);
  visit(doc, {
    Pair(_, pair) {
      if (isPair(pair) && isScalar(pair.key) && (pair.key.value === "options" || pair.key.value === "teachers") && isSeq(pair.value)) pair.value.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

export type SpecError = { line: number | null; message: string };

/** Parse YAML and validate it, with errors that point at a line and say where in the course they are. */
export function parseSpec<S extends z.ZodType>(text: string, schema: S): { data: z.output<S>; errors: [] } | { data: null; errors: SpecError[] } {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: true });
  if (doc.errors.length) {
    // One syntax error per line is enough; the rest are usually knock-on effects.
    const seen = new Set<number | null>();
    return {
      data: null,
      errors: doc.errors.flatMap((e) => {
        const line = e.linePos?.[0]?.line ?? null;
        if (seen.has(line)) return [];
        seen.add(line);
        return [{ line, message: `YAML syntax (often indentation): ${e.message.split("\n")[0]!.replace(/ at line \d+, column \d+:?$/, "")}` }];
      }),
    };
  }
  const raw = doc.toJS() ?? {};
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data, errors: [] };
  return {
    data: null,
    errors: result.error.issues.map((issue) => {
      // Point at the offending node, or the closest parent that exists (e.g. for a missing key).
      let line: number | null = null;
      for (let n = issue.path.length; n >= 0 && line === null; n--) {
        const node = doc.getIn(issue.path.slice(0, n) as (string | number)[], true) as { range?: [number, number] } | undefined;
        const at = node && (isMap(node) || isSeq(node) || node.range) ? node.range?.[0] : undefined;
        if (at !== undefined) line = lc.linePos(at).line;
      }
      const where = describePath(issue.path as (string | number)[], raw);
      return { line, message: where ? `${where}: ${friendly(issue)}` : friendly(issue) };
    }),
  };
}

function friendly(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") return `Unknown field ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
  if (issue.code === "invalid_value") return `Must be one of: ${issue.values.join(", ")}`;
  if (issue.code === "invalid_type" && issue.input === undefined) return "This field is required";
  return issue.message;
}

/** ["tasks", 2, "questions", 0, "correct"] → 'Task 3 "Week 3" › question 1 › correct' */
function describePath(path: (string | number)[], raw: unknown): string {
  const parts: string[] = [];
  let node: unknown = raw;
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    const next = (node as Record<string | number, unknown> | undefined)?.[key];
    if (typeof key === "number") {
      const parent = path[i - 1];
      if (parent === "tasks") {
        const title = (next as { title?: unknown } | undefined)?.title;
        parts.push(`Task ${key + 1}${typeof title === "string" ? ` "${title}"` : ""}`);
      } else if (parent === "questions") parts.push(`question ${key + 1}`);
      else if (parent === "options") parts.push(`option ${key + 1}`);
      else parts.push(String(key + 1));
    } else if (key !== "tasks" && key !== "questions" && !(key === "options" && typeof path[i + 1] === "number")) parts.push(key);
    node = next;
  }
  return parts.join(" › ");
}

/** A prompt teachers can paste into an AI chat to get questions back in the right format. */
export function aiPrompt(kind: "task" | "course") {
  const example = kind === "task" ? TASK_EXAMPLE : COURSE_EXAMPLE;
  return `Write in-class quiz questions for me in this exact YAML format, and reply with only the YAML.

Rules:
- "q" is the question. It is shown on the projector; students answer on their phone.
- "options": 2 to 6 short answer options. "correct": the text of the right option. Leave "correct" out for a poll without a right answer.
- "open: true" (and no options) for a question students answer by typing, e.g. a question they have about the reading.
- Optional: "confidence: true" asks students how sure they are; "points: attempt" gives a point for any answer instead of the right one; "seconds" sets the time limit (default 30).
- Keep questions short enough to read on a projector in a few seconds.
${kind === "course" ? '- Keep any existing "id" lines unchanged, and don\'t add ids to new tasks.\n' : ""}
Example:

${example}
My request: `;
}

const TASK_EXAMPLE = `title: Week 3 warm-up
questions:
  - q: Which effect fades fastest?
    options: [Framing, Priming, Cultivation]
    correct: Priming
    confidence: true
  - q: Which topic would you like to discuss further?
    options: [Framing, Priming, Agenda setting]
  - q: What is one question you have about this week's reading?
    open: true
    seconds: 90`;

const COURSE_EXAMPLE = `course: Communication Science 1
defaults:
  review: never
tasks:
  - title: Week 1 check-in
    kind: attendance
${TASK_EXAMPLE.replace(/^/gm, "    ").replace(/^ {4}title/, "  - title")}`;
