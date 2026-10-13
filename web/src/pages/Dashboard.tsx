import { BookOpen, Plus, Users } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type CourseSummary, useMe } from "@/lib/api";

type HistoryItem = {
  runId: string;
  title: string;
  course: string;
  kind: "attendance" | "quiz";
  startedAt: number;
  questions: number;
  answered: number;
  notCounted: number;
  typed: number;
  canReview: boolean;
};

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
              <p className="text-sm text-muted-foreground">
                {i.course} · {new Date(i.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              {i.canReview && (
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/review/${i.runId}`}>Review & practice</Link>
                </Button>
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
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [newTitle, setNewTitle] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (me?.role === "teacher") api<CourseSummary[]>("/teacher/courses").then(setCourses);
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

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const course = await api<{ id: string }>("/teacher/courses", { body: { title: newTitle } });
      navigate(`/courses/${course.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Shell me={me}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your courses</h1>
        {newTitle === null && (
          <Button onClick={() => setNewTitle("")}>
            <Plus /> New course
          </Button>
        )}
      </div>
      {newTitle !== null && (
        <form onSubmit={create} className="mb-6 flex gap-2">
          <Input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Course title, e.g. Communication Science 1" />
          <Button type="submit">Create</Button>
          <Button type="button" variant="ghost" onClick={() => setNewTitle(null)}>
            Cancel
          </Button>
        </form>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {courses?.length === 0 && <p className="text-muted-foreground">No courses yet. A course holds your check-ins and quizzes for one class.</p>}
        {courses?.map((c) => (
          <Link key={c.id} to={`/courses/${c.id}`}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="size-4" /> {c.title}
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  {c.taskCount} {c.taskCount === 1 ? "task" : "tasks"}
                  {c.shared && (
                    <span className="flex items-center gap-1">
                      · <Users className="size-3.5" /> shared with you
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <History />
    </Shell>
  );
}
