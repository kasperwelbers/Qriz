import { ClipboardCheck, Copy, FileCode2, ListChecks, Play, Plus, Settings } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type CheckAction, type CourseDefaults, type CourseDetail, type CourseTask, defaultChecks, type Run, useMe } from "@/lib/api";
import { ACTION_LABELS, CHECK_KEYS, CHECK_LABELS, REVIEW_LABELS } from "@/lib/checks";

export default function Course() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api<CourseDetail>(`/teacher/courses/${id}`).then(setCourse, (e) => setError(e.message)), [id]);
  useEffect(() => {
    if (me?.role === "teacher") load();
  }, [me, load]);

  if (me === undefined) return null;
  if (me?.role !== "teacher") return <Navigate to="/" replace />;
  if (!course) return <Shell me={me}>{error && <p className="text-destructive">{error}</p>}</Shell>;

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => setError((e as Error).message));
  const start = (task: CourseTask) => run(async () => navigate(`/present/${(await api<Run>(`/teacher/tasks/${task.id}/runs`, { method: "POST" })).id}`));
  const duplicateTask = (task: CourseTask) => run(async () => (await api(`/teacher/tasks/${task.id}/duplicate`, { method: "POST" }), load()));
  const duplicateCourse = () =>
    run(async () => {
      if (!confirm(`Make a copy of "${course.title}" with all its tasks (without results)?`)) return;
      navigate(`/courses/${(await api<{ id: string }>(`/teacher/courses/${course.id}/duplicate`, { method: "POST" })).id}`);
    });
  const deleteCourse = () =>
    run(async () => {
      if (!confirm(`Delete "${course.title}" with all its tasks and results? This can't be undone.`)) return;
      await api(`/teacher/courses/${course.id}`, { method: "DELETE" });
      navigate("/");
    });

  return (
    <Shell me={me}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:underline">
            ← Courses
          </Link>
          <h1 className="text-2xl font-semibold">{course.title}</h1>
          <p className="text-sm text-muted-foreground">{REVIEW_LABELS[course.defaults.review ?? "never"]} (default)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen((v) => !v)}>
            <Settings /> Settings
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/courses/${course.id}/yaml`}>
              <FileCode2 /> Edit as YAML
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={duplicateCourse}>
            <Copy /> Duplicate course
          </Button>
        </div>
      </div>

      {settingsOpen && (
        <CourseSettings
          course={course}
          onSaved={() => {
            setSettingsOpen(false);
            load();
          }}
          onDelete={course.isOwner ? deleteCourse : undefined}
        />
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <Button size="sm" asChild>
          <Link to={`/courses/${course.id}/tasks/new`}>
            <Plus /> New task
          </Link>
        </Button>
      </div>
      <div className="grid gap-3">
        {course.tasks.length === 0 && <p className="text-muted-foreground">No tasks yet. Add one here, or write several at once with Edit as YAML.</p>}
        {course.tasks.map((t) => (
          <Card key={t.id} className="gap-4">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1.5">
                <CardTitle className="flex items-center gap-2">
                  {t.kind === "quiz" ? <ListChecks className="size-4" /> : <ClipboardCheck className="size-4" />}
                  {t.title}
                </CardTitle>
                <CardDescription>
                  {t.kind === "quiz" ? `${t.questionCount} ${t.questionCount === 1 ? "question" : "questions"}` : "Attendance"}
                  {t.review === "after-session" && " · review open"}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/tasks/${t.id}`}>Edit</Link>
                </Button>
                <Button variant="outline" size="sm" title="Duplicate" aria-label="Duplicate" onClick={() => duplicateTask(t)}>
                  <Copy />
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

function CourseSettings({ course, onSaved, onDelete }: { course: CourseDetail; onSaved: () => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(course.title);
  const [teachers, setTeachers] = useState(course.teachers.join(", "));
  const [defaults, setDefaults] = useState<CourseDefaults>(course.defaults);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/teacher/courses/${course.id}`, {
        method: "PUT",
        body: { title, teachers: teachers.split(/[\s,;]+/).filter(Boolean), defaults },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Course settings</CardTitle>
        <CardDescription>Defaults apply to every task in this course, unless a task sets its own.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="course-title">Title</Label>
            <Input id="course-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="course-teachers">Co-teachers</Label>
            <Input id="course-teachers" value={teachers} onChange={(e) => setTeachers(e.target.value)} placeholder="colleague@vu.nl, another@vu.nl" />
            <p className="text-xs text-muted-foreground">They can edit tasks, run sessions and see results. They need a teacher account.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label>Review</Label>
            <select
              value={defaults.review ?? "never"}
              onChange={(e) => setDefaults((d) => ({ ...d, review: e.target.value as "never" | "after-session" }))}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              {Object.entries(REVIEW_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {CHECK_KEYS.map((key) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{CHECK_LABELS[key].title}</p>
                <p className="text-xs text-muted-foreground">{CHECK_LABELS[key].help}</p>
              </div>
              <select
                value={defaults.checks?.[key] ?? defaultChecks[key]}
                onChange={(e) => setDefaults((d) => ({ ...d, checks: { ...d.checks, [key]: e.target.value as CheckAction } }))}
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between">
            <Button type="submit">Save settings</Button>
            {onDelete && (
              <Button type="button" variant="destructive" onClick={onDelete}>
                Delete course
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
