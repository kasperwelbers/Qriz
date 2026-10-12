import { ClipboardCheck, ListChecks, Play, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type Run, type Task, useMe } from "@/lib/api";

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
