import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { parseSpec, type SpecError, TaskSpec, taskFromSpec, taskToSpec, toYaml } from "@shared/spec";
import { Shell } from "@/components/Shell";
import { CopyAiPrompt, SpecErrors, SuspendedYamlEditor } from "@/components/SpecTools";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type CheckAction, type CourseDefaults, defaultChecks, letter, type Question, type TaskData, useMe } from "@/lib/api";
import { ACTION_LABELS, CHECK_KEYS, CHECK_LABELS, REVIEW_LABELS } from "@/lib/checks";
import { cn } from "@/lib/utils";

const blankQuestion = (): Question => ({
  type: "choice",
  prompt: "",
  options: ["", "", "", ""],
  correctIndex: 0,
  scoring: "correct",
  askConfidence: false,
  timeLimitSec: 30,
});

const blankTask = (): TaskData => ({ title: "", kind: "quiz", review: null, checks: {}, questions: [blankQuestion()] });

type CourseInfo = { id: string; title: string; defaults: CourseDefaults };

export default function TaskEditor() {
  const { id, courseId } = useParams();
  const isNew = !id;
  const me = useMe();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskData>(blankTask);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [tab, setTab] = useState<"form" | "yaml">("form");
  const [yaml, setYaml] = useState("");
  const [yamlErrors, setYamlErrors] = useState<SpecError[]>([]);
  const [reveal, setReveal] = useState<{ line: number; n: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (me?.role !== "teacher") return;
    if (isNew) api<CourseInfo>(`/teacher/courses/${courseId}`).then(setCourse);
    else
      api<TaskData & { course: CourseInfo }>(`/teacher/tasks/${id}`).then(({ course, ...t }) => {
        setCourse(course);
        setTask({ ...t, questions: t.questions.length ? t.questions : [blankQuestion()] });
      });
  }, [id, courseId, isNew, me]);

  // Validate YAML as you type.
  useEffect(() => {
    if (tab !== "yaml") return;
    const timer = setTimeout(() => setYamlErrors(parseSpec(yaml, TaskSpec).errors), 300);
    return () => clearTimeout(timer);
  }, [yaml, tab]);

  if (me === undefined) return null;
  if (me?.role !== "teacher") return <Navigate to="/" replace />;

  const update = (patch: Partial<TaskData>) => setTask((t) => ({ ...t, ...patch }));
  const updateQ = (i: number, patch: Partial<Question>) => setTask((t) => ({ ...t, questions: t.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));

  /** The form state, or the parsed YAML when that tab is open. Null if the YAML has errors. */
  function current(): TaskData | null {
    if (tab === "form") return task;
    const { data, errors } = parseSpec(yaml, TaskSpec);
    setYamlErrors(errors);
    return data ? { ...taskFromSpec(data), id: task.id } : null;
  }

  function switchTab(next: "form" | "yaml") {
    if (next === tab) return;
    if (next === "yaml") {
      setYaml(toYaml(taskToSpec(task, false)));
      setYamlErrors([]);
    } else {
      const data = current();
      if (!data) return;
      setTask({ ...data, questions: data.questions.length ? data.questions : [blankQuestion()] });
    }
    setTab(next);
  }

  async function save() {
    setError("");
    const data = current();
    if (!data) return setError("Fix the errors in the YAML first.");
    try {
      if (isNew) await api(`/teacher/courses/${courseId}/tasks`, { body: data });
      else await api(`/teacher/tasks/${id}`, { method: "PUT", body: data });
      navigate(`/courses/${course?.id ?? courseId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm("Delete this task and all its results?")) return;
    await api(`/teacher/tasks/${id}`, { method: "DELETE" });
    navigate(`/courses/${course?.id}`);
  }

  const courseReview = course?.defaults.review ?? "never";

  return (
    <Shell me={me}>
      <div className="grid gap-6">
        <div>
          {course && (
            <Link to={`/courses/${course.id}`} className="text-sm text-muted-foreground hover:underline">
              ← {course.title}
            </Link>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">{isNew ? "New task" : "Edit task"}</h1>
            <div className="flex w-fit rounded-md border p-0.5">
              {(["form", "yaml"] as const).map((t) => (
                <button key={t} type="button" onClick={() => switchTab(t)} className={cn("rounded px-3 py-1.5 text-sm font-medium", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                  {t === "form" ? "Form" : "YAML"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tab === "yaml" ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Type or paste questions. Press Ctrl+Space for suggestions.</p>
              <CopyAiPrompt kind="task" />
            </div>
            <SuspendedYamlEditor kind="task" value={yaml} onChange={setYaml} errors={yamlErrors} revealLine={reveal} />
            <SpecErrors errors={yamlErrors} onPick={(line) => setReveal((r) => ({ line, n: (r?.n ?? 0) + 1 }))} />
          </div>
        ) : (
          <TaskForm task={task} update={update} updateQ={updateQ} setTask={setTask} courseReview={courseReview} courseChecks={course?.defaults.checks ?? {}} />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-between">
          <Button onClick={save}>Save</Button>
          {!isNew && (
            <Button variant="destructive" onClick={remove}>
              Delete task
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

function TaskForm({
  task,
  update,
  updateQ,
  setTask,
  courseReview,
  courseChecks,
}: {
  task: TaskData;
  update: (p: Partial<TaskData>) => void;
  updateQ: (i: number, p: Partial<Question>) => void;
  setTask: React.Dispatch<React.SetStateAction<TaskData>>;
  courseReview: "never" | "after-session";
  courseChecks: Partial<Record<string, CheckAction>>;
}) {
  const { questions } = task;
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={task.title} onChange={(e) => update({ title: e.target.value })} placeholder="Week 3 warm-up" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["quiz", "attendance"] as const).map((k) => (
            <Button key={k} variant={task.kind === k ? "default" : "outline"} onClick={() => update({ kind: k })}>
              {k === "quiz" ? "Quiz" : "Attendance only"}
            </Button>
          ))}
        </div>
        <select
          value={task.review ?? ""}
          onChange={(e) => update({ review: (e.target.value || null) as TaskData["review"] })}
          className="h-9 rounded-md border bg-background px-3 text-sm"
          aria-label="Review"
        >
          <option value="">Course default: {REVIEW_LABELS[courseReview].toLowerCase()}</option>
          {Object.entries(REVIEW_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {task.kind === "quiz" && (
        <>
          <p className="text-sm text-muted-foreground">
            Questions are only shown on the projector; phones show the options, each in its own order. Click a letter to mark the right answer, or click it again for
            a poll with no right answer.
          </p>
          {questions.map((q, i) => (
            <Card key={i} className="gap-4">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Question {i + 1}</CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`t${i}`} className="text-muted-foreground">
                    Seconds
                  </Label>
                  <Input id={`t${i}`} type="number" min={5} max={600} className="w-20" value={q.timeLimitSec} onChange={(e) => updateQ(i, { timeLimitSec: Number(e.target.value) })} />
                  <Button variant="ghost" size="icon" aria-label="Remove question" disabled={questions.length === 1} onClick={() => setTask((t) => ({ ...t, questions: t.questions.filter((_, j) => j !== i) }))}>
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Segmented
                  value={q.type}
                  options={[
                    ["choice", "Multiple choice"],
                    ["open", "Open answer"],
                  ]}
                  onChange={(type) => updateQ(i, type === "choice" && q.options.length < 2 ? { type, options: ["", "", "", ""] } : { type })}
                />
                <Textarea
                  value={q.prompt}
                  placeholder={q.type === "open" ? "e.g. What is one question you have about this week's reading?" : "Question"}
                  onChange={(e) => updateQ(i, { prompt: e.target.value })}
                />
                {q.type === "open" ? (
                  <p className="text-sm text-muted-foreground">Students type up to 500 characters. Any answer in time earns the point. You can show the answers anonymously on the projector afterwards.</p>
                ) : (
                  <>
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <button
                          type="button"
                          title={q.correctIndex === oi ? "Unmark (no right answer)" : "Mark as correct"}
                          onClick={() => updateQ(i, { correctIndex: q.correctIndex === oi ? null : oi })}
                          className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border font-semibold", q.correctIndex === oi && "border-green-600 bg-green-600 text-white")}
                        >
                          {letter(oi)}
                        </button>
                        <Input value={o} placeholder={`Option ${letter(oi)}`} onChange={(e) => updateQ(i, { options: q.options.map((x, j) => (j === oi ? e.target.value : x)) })} />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove option"
                          disabled={q.options.length <= 2}
                          onClick={() =>
                            updateQ(i, {
                              options: q.options.filter((_, j) => j !== oi),
                              correctIndex: q.correctIndex === oi ? null : q.correctIndex !== null && q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex,
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    {q.options.length < 6 && (
                      <Button variant="outline" size="sm" className="w-fit" onClick={() => updateQ(i, { options: [...q.options, ""] })}>
                        <Plus /> Option
                      </Button>
                    )}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1 text-sm">
                      {q.correctIndex === null ? (
                        <span className="text-muted-foreground">Poll: no right answer, any answer in time earns the point.</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Point for</span>
                          <Segmented
                            size="sm"
                            value={q.scoring}
                            options={[
                              ["correct", "Right answer"],
                              ["attempt", "Any answer"],
                            ]}
                            onChange={(scoring) => updateQ(i, { scoring })}
                          />
                        </div>
                      )}
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={q.askConfidence} onChange={(e) => updateQ(i, { askConfidence: e.target.checked })} className="size-4 accent-primary" />
                        Ask how sure they are
                      </label>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" className="w-fit" onClick={() => setTask((t) => ({ ...t, questions: [...t.questions, blankQuestion()] }))}>
            <Plus /> Add question
          </Button>

          <Card>
            <CardHeader>
              <CardTitle>When a check fires during a question</CardTitle>
              <CardDescription>Every check is always recorded on the results page. Choose whether it also costs the answer or shows the student a warning.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {CHECK_KEYS.map((key) => (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{CHECK_LABELS[key].title}</p>
                    <p className="text-sm text-muted-foreground">{CHECK_LABELS[key].help}</p>
                  </div>
                  <select
                    value={task.checks[key] ?? ""}
                    onChange={(e) => {
                      const checks = { ...task.checks };
                      if (e.target.value) checks[key] = e.target.value as CheckAction;
                      else delete checks[key];
                      update({ checks });
                    }}
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">Course default: {ACTION_LABELS[courseChecks[key] ?? defaultChecks[key]].toLowerCase()}</option>
                    {(Object.keys(ACTION_LABELS) as CheckAction[]).map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <p className="text-sm text-muted-foreground">Check-in signals (slow scan, shared phone, different network) never block anyone; they only show up on the results page.</p>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: [T, string][]; onChange: (v: T) => void; size?: "sm" }) {
  return (
    <div className="flex w-fit rounded-md border p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn("rounded px-3 font-medium", size === "sm" ? "py-1 text-xs" : "py-1.5 text-sm", value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
