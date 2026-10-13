import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type CheckAction, type Checks, defaultChecks, letter, type Question, useMe } from "@/lib/api";
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

const CHECK_LABELS: Record<keyof Checks, { title: string; help: string }> = {
  leftPage: { title: "Leaving the page", help: "Switching apps or tabs while a question is open." },
  splitScreen: { title: "Split screen", help: "Using the quiz next to another app." },
  connectionLost: { title: "Connection lost", help: "The phone dropped offline during a question. Often just bad wifi." },
};

const ACTION_LABELS: Record<CheckAction, string> = {
  disqualify: "Answer doesn't count",
  warn: "Warn student, answer counts",
  record: "Record silently",
};

export default function TaskEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const me = useMe();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"attendance" | "quiz">("quiz");
  const [questions, setQuestions] = useState<Question[]>([blankQuestion()]);
  const [checks, setChecks] = useState<Checks>(defaultChecks);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isNew || me?.role !== "teacher") return;
    api<{ title: string; kind: "attendance" | "quiz"; checks: Checks; questions: Question[] }>(`/teacher/tasks/${id}`).then((t) => {
      setTitle(t.title);
      setKind(t.kind);
      setChecks(t.checks);
      setQuestions(t.questions.length ? t.questions : [blankQuestion()]);
    });
  }, [id, isNew, me]);

  if (me === undefined) return null;
  if (me?.role !== "teacher") return <Navigate to="/" replace />;

  const update = (i: number, patch: Partial<Question>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function save() {
    setError("");
    const body = { title, kind, checks, questions: kind === "quiz" ? questions : [] };
    try {
      if (isNew) await api("/teacher/tasks", { body });
      else await api(`/teacher/tasks/${id}`, { method: "PUT", body });
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm("Delete this task and all its results?")) return;
    await api(`/teacher/tasks/${id}`, { method: "DELETE" });
    navigate("/");
  }

  return (
    <Shell me={me}>
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold">{isNew ? "New task" : "Edit task"}</h1>
        <div className="grid gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 3 warm-up" />
        </div>
        <div className="flex gap-2">
          {(["quiz", "attendance"] as const).map((k) => (
            <Button key={k} variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
              {k === "quiz" ? "Quiz" : "Attendance only"}
            </Button>
          ))}
        </div>

        {kind === "quiz" && (
          <>
            <p className="text-sm text-muted-foreground">
              Questions are only shown on the projector; phones show the options, each in its own order. Click a letter to mark the right answer, or click it again
              for a poll with no right answer.
            </p>
            {questions.map((q, i) => (
              <Card key={q.id ?? i} className="gap-4">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>Question {i + 1}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`t${i}`} className="text-muted-foreground">
                      Seconds
                    </Label>
                    <Input id={`t${i}`} type="number" min={5} max={600} className="w-20" value={q.timeLimitSec} onChange={(e) => update(i, { timeLimitSec: Number(e.target.value) })} />
                    <Button variant="ghost" size="icon" aria-label="Remove question" disabled={questions.length === 1} onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
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
                    onChange={(type) => update(i, type === "choice" && q.options.length < 2 ? { type, options: ["", "", "", ""] } : { type })}
                  />
                  <Textarea
                    value={q.prompt}
                    placeholder={q.type === "open" ? "e.g. What is one question you have about this week's reading?" : "Question"}
                    onChange={(e) => update(i, { prompt: e.target.value })}
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
                            onClick={() => update(i, { correctIndex: q.correctIndex === oi ? null : oi })}
                            className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border font-semibold", q.correctIndex === oi && "border-green-600 bg-green-600 text-white")}
                          >
                            {letter(oi)}
                          </button>
                          <Input value={o} placeholder={`Option ${letter(oi)}`} onChange={(e) => update(i, { options: q.options.map((x, j) => (j === oi ? e.target.value : x)) })} />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove option"
                            disabled={q.options.length <= 2}
                            onClick={() =>
                              update(i, {
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
                        <Button variant="outline" size="sm" className="w-fit" onClick={() => update(i, { options: [...q.options, ""] })}>
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
                              onChange={(scoring) => update(i, { scoring })}
                            />
                          </div>
                        )}
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={q.askConfidence} onChange={(e) => update(i, { askConfidence: e.target.checked })} className="size-4 accent-primary" />
                          Ask how sure they are
                        </label>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" className="w-fit" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
              <Plus /> Add question
            </Button>

            <Card>
              <CardHeader>
                <CardTitle>When a check fires during a question</CardTitle>
                <CardDescription>Every check is always recorded on the results page. Choose whether it also costs the answer or shows the student a warning.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {(Object.keys(CHECK_LABELS) as (keyof Checks)[]).map((key) => (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{CHECK_LABELS[key].title}</p>
                      <p className="text-sm text-muted-foreground">{CHECK_LABELS[key].help}</p>
                    </div>
                    <select
                      value={checks[key]}
                      onChange={(e) => setChecks((c) => ({ ...c, [key]: e.target.value as CheckAction }))}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
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
