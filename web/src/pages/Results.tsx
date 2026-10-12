import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, letter, type Question, useMe } from "@/lib/api";
import { cn } from "@/lib/utils";

type Answer = { choice: number; disqualified: boolean; reason: string | null; flag: string | null; ms: number } | null;
type Results = {
  task: { title: string; kind: string };
  run: { startedAt: number; endedAt: number | null };
  questions: (Question & { id: string })[];
  students: { userId: string; email: string; scannedAt: number; qrIssuedAt: number; completedAt: number; suspicion: string[]; score: number; answers: Answer[] }[];
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
              {data.questions.length > 0 && <th className="p-3 font-medium">Score</th>}
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
                {s.answers.map((a, i) => (
                  <td
                    key={i}
                    title={a ? `${(a.ms / 1000).toFixed(1)} s${a.reason ? ` · ${a.reason}` : ""}${a.flag ? ` · ${a.flag}` : ""}` : "No answer"}
                    className={cn(
                      "p-3 text-center font-medium",
                      a && !a.disqualified && a.choice === data.questions[i]!.correctIndex && "text-green-600",
                      a && !a.disqualified && a.choice !== data.questions[i]!.correctIndex && "text-red-600",
                      a?.disqualified && "text-muted-foreground line-through",
                    )}
                  >
                    {a ? letter(a.choice) : "–"}
                    {a?.flag && <span className="text-amber-600">*</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
