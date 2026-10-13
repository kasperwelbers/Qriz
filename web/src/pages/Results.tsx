import { Download } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, letter, type Question, useMe } from "@/lib/api";
import { cn } from "@/lib/utils";

type Answer = { choice: number | null; text: string | null; confidence: number | null; disqualified: boolean; reason: string | null; flag: string | null; ms: number } | null;
type Results = {
  task: { title: string; kind: string };
  run: { startedAt: number; endedAt: number | null };
  questions: (Question & { id: string })[];
  students: { userId: string; email: string; scannedAt: number; qrIssuedAt: number; completedAt: number; suspicion: string[]; paper: boolean; score: number; answers: Answer[] }[];
};

export default function Results() {
  const { runId } = useParams();
  const me = useMe();
  const [data, setData] = useState<Results | null>(null);

  const live = data !== null && data.run.endedAt === null;
  useEffect(() => {
    if (me?.role !== "teacher") return;
    const load = () => api<Results>(`/teacher/runs/${runId}/results`).then(setData);
    load();
    // Keep refreshing while the session runs, so this works as a live check-in list on the teacher's own screen.
    if (!live) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [me, runId, live]);

  if (me === null) return <Navigate to="/login" replace />;
  if (!data) return null;
  const reload = () => api<Results>(`/teacher/runs/${runId}/results`).then(setData);

  return (
    <Shell me={me}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{data.task.title}</h1>
          <p className="text-muted-foreground">
            {new Date(data.run.startedAt).toLocaleString()} · {data.students.length} checked in
            {live && " · live"}
          </p>
          {data.students.some((s) => s.suspicion.length) && (
            <p className="mt-1 text-sm text-amber-700">
              {data.students.filter((s) => s.suspicion.length).length} student(s) with something worth a second look. These are hints, not proof.
            </p>
          )}
        </div>
        <Button variant="outline" asChild>
          <a href={`/api/teacher/runs/${runId}/export.csv`}>
            <Download /> CSV
          </a>
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Student</th>
              <th className="p-3 font-medium">Checked in</th>
              {data.questions.length > 0 && <th className="p-3 font-medium">Points</th>}
              {data.questions.map((_, i) => (
                <th key={i} className="p-3 text-center font-medium">
                  Q{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.userId} className="border-t">
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {s.email}
                    {s.paper && <Badge variant="secondary">paper</Badge>}
                    {s.suspicion.map((f) => (
                      <Badge key={f} variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="p-3 text-muted-foreground" title={`QR was ${((s.scannedAt - s.qrIssuedAt) / 1000).toFixed(1)} s old when scanned`}>
                  {new Date(s.scannedAt).toLocaleTimeString()}
                </td>
                {data.questions.length > 0 && (
                  <td className="p-3 font-medium">
                    {s.score}/{data.questions.length}
                  </td>
                )}
                {s.answers.map((a, i) => {
                  const q = data.questions[i]!;
                  // Only color right/wrong where being right is what earns the point.
                  const judged = a && !a.disqualified && q.type === "choice" && q.correctIndex !== null && q.scoring === "correct";
                  return (
                    <td
                      key={i}
                      title={a ? [`${(a.ms / 1000).toFixed(1)} s`, a.text, a.confidence !== null && `${a.confidence}% sure`, a.reason, a.flag].filter(Boolean).join(" · ") : "No answer"}
                      className={cn(
                        "p-3 text-center font-medium",
                        judged && a.choice === q.correctIndex && "text-green-600",
                        judged && a.choice !== q.correctIndex && "text-red-600",
                        a?.disqualified && "text-muted-foreground line-through",
                      )}
                    >
                      {!a ? "–" : a.choice !== null ? letter(a.choice) : <span className="inline-block max-w-40 truncate align-bottom font-normal">{a.text}</span>}
                      {a?.confidence != null && <span className="ml-1 text-xs font-normal text-muted-foreground">{a.confidence}%</span>}
                      {a?.flag && <span className="text-amber-600">*</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.questions.length > 0 && <PaperEntry runId={runId!} questions={data.questions} onSaved={reload} />}
    </Shell>
  );
}

/** For students without a smartphone: enter what they wrote on paper. Submitting the same email again overwrites. */
function PaperEntry({ runId, questions, onSaved }: { runId: string; questions: Question[]; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/teacher/runs/${runId}/paper-answers`, { body: { email, answers } });
      setSaved(email);
      setEmail("");
      setAnswers(questions.map(() => null));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Add a paper answer sheet</CardTitle>
        <CardDescription>For students without a smartphone. This marks them present and stores their answers. Entering the same email again replaces their answers.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="paper-email">Student email</Label>
            <Input id="paper-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-4">
            {questions.map((q, i) => (
              <div key={i} className="grid gap-1.5">
                <Label>Q{i + 1}</Label>
                <div className="flex gap-1">
                  {q.type === "open" && <span className="flex h-9 items-center text-sm text-muted-foreground">open</span>}
                  {q.options.map((_, oi) => (
                    <button
                      type="button"
                      key={oi}
                      onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? (x === oi ? null : oi) : x)))}
                      className={cn("size-9 rounded-md border text-sm font-semibold", answers[i] === oi && "border-primary bg-primary text-primary-foreground")}
                    >
                      {letter(oi)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-muted-foreground">Saved {saved}.</p>}
          <Button type="submit" className="w-fit">
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
