import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, letter, type Question, useMe } from "@/lib/api";
import { cn } from "@/lib/utils";

const blankQuestion = (): Question => ({ prompt: "", options: ["", "", "", ""], correctIndex: 0, timeLimitSec: 30 });

export default function TaskEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const me = useMe();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"attendance" | "quiz">("quiz");
  const [questions, setQuestions] = useState<Question[]>([blankQuestion()]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isNew || me?.role !== "teacher") return;
    api<{ title: string; kind: "attendance" | "quiz"; questions: Question[] }>(`/teacher/tasks/${id}`).then((t) => {
      setTitle(t.title);
      setKind(t.kind);
      setQuestions(t.questions.length ? t.questions : [blankQuestion()]);
    });
  }, [id, isNew, me]);

  if (me === undefined) return null;
  if (me?.role !== "teacher") return <Navigate to="/" replace />;

  const update = (i: number, patch: Partial<Question>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function save() {
    setError("");
    const body = { title, kind, questions: kind === "quiz" ? questions : [] };
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
              Questions and options are only shown on the projector. Students see answer letters on their phone. Mark the correct option by clicking its letter.
            </p>
            {questions.map((q, i) => (
              <Card key={q.id ?? i} className="gap-4">
                <CardHeader className="flex flex-row items-center justify-between">
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
                  <Textarea value={q.prompt} placeholder="Question" onChange={(e) => update(i, { prompt: e.target.value })} />
                  {q.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Mark as correct"
                        onClick={() => update(i, { correctIndex: oi })}
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
                            correctIndex: q.correctIndex === oi ? 0 : q.correctIndex !== null && q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex,
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
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" className="w-fit" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
              <Plus /> Add question
            </Button>
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
