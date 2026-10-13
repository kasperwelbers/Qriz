import { ClipboardCheck, ListChecks, Play, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type Run, type Task, useMe } from "@/lib/api";

type HistoryItem = { runId: string; title: string; kind: "attendance" | "quiz"; startedAt: number; questions: number; answered: number; notCounted: number; typed: number };

/** A student's own participation record: when they were there and how they took part, not a score. */
function History() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => {
    api<HistoryItem[]>("/me/history").then(setItems, () => setItems([]));
  }, []);
  if (!items?.length) return null;
  const quizzes = items.filter((i) => i.kind === "quiz");
  const answered = quizzes.reduce((n, i) => n + i.answered - i.notCounted, 0);
  const asked = quizzes.reduce((n, i) => n + i.questions, 0);
  return (
    <div className="mt-8 grid gap-4">
      <div>
        <h2 className="text-xl font-semibold">Your participation</h2>
        <p className="text-muted-foreground">
          Present {items.length} {items.length === 1 ? "time" : "times"}
          {asked > 0 && ` · answered ${answered} of ${asked} questions`}
        </p>
      </div>
      <div className="divide-y rounded-lg border">
        {items.map((i) => (
          <div key={i.runId} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">{i.title}</p>
              <p className="text-sm text-muted-foreground">{new Date(i.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">present</Badge>
              {i.kind === "quiz" && (
                <Badge variant="outline">
                  answered {i.answered - i.notCounted}/{i.questions}
                </Badge>
              )}
              {i.typed > 0 && <Badge variant="outline">wrote {i.typed} {i.typed === 1 ? "answer" : "answers"}</Badge>}
              {i.notCounted > 0 && (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  {i.notCounted} not counted
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (me?.role === "teacher") api<Task[]>("/teacher/tasks").then(setTasks);
  }, [me]);

  if (me === undefined) return null;
  if (me === null) return <Navigate to="/login" replace />;

  if (me.role !== "teacher")
    return (
      <Shell me={me}>
        <Card>
          <CardHeader>
            <CardTitle>You're logged in</CardTitle>
            <CardDescription>Scan the QR code on the screen in class to check in or join a quiz. You stay logged in on this device.</CardDescription>
          </CardHeader>
        </Card>
        <History />
      </Shell>
    );

  async function start(task: Task) {
    try {
      const run = await api<Run>(`/teacher/tasks/${task.id}/runs`, { method: "POST" });
      navigate(`/present/${run.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Shell me={me}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your tasks</h1>
        <Button asChild>
          <Link to="/tasks/new">
            <Plus /> New task
          </Link>
        </Button>
      </div>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4">
        {tasks?.length === 0 && <p className="text-muted-foreground">No tasks yet. Create an attendance check or a quiz to get started.</p>}
        {tasks?.map((t) => (
          <Card key={t.id} className="gap-4">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="grid gap-1.5">
                <CardTitle className="flex items-center gap-2">
                  {t.kind === "quiz" ? <ListChecks className="size-4" /> : <ClipboardCheck className="size-4" />}
                  {t.title}
                </CardTitle>
                <CardDescription>{t.kind === "quiz" ? "Quiz" : "Attendance"}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/tasks/${t.id}`}>Edit</Link>
                </Button>
                <Button size="sm" onClick={() => start(t)}>
                  <Play /> Start
                </Button>
              </div>
            </CardHeader>
            {t.runs.length > 0 && (
              <CardContent className="flex flex-wrap gap-2">
                {t.runs.map((r) => (
                  <Link key={r.id} to={r.endedAt ? `/results/${r.id}` : `/present/${r.id}`}>
                    <Badge variant={r.endedAt ? "secondary" : "default"}>
                      {new Date(r.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {!r.endedAt && " · live"}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </Shell>
  );
}
