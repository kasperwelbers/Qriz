import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, letter, useMe } from "@/lib/api";
import { cn } from "@/lib/utils";

type ReviewQuestion = {
  id: string;
  type: "choice" | "open";
  prompt: string;
  options: string[];
  correctIndex: number | null;
  mine: { choice: number | null; text: string | null; confidence: number | null; counted: boolean } | null;
};
type ReviewData = { title: string; course: string; startedAt: number; questions: ReviewQuestion[] };

/** A finished session, for students to look back at their answers and practise again. */
export default function Review() {
  const { runId } = useParams();
  const me = useMe();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [practising, setPractising] = useState(false);

  useEffect(() => {
    if (me) api<ReviewData>(`/me/runs/${runId}/review`).then(setData, (e) => setError(e.message));
  }, [me, runId]);

  if (me === undefined) return null;
  if (me === null) return <Navigate to="/login" replace />;

  return (
    <Shell me={me}>
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← Your participation
      </Link>
      {error && <p className="mt-4 text-muted-foreground">{error}</p>}
      {data && (
        <div className="mt-2 grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{data.title}</h1>
              <p className="text-muted-foreground">
                {data.course} · {new Date(data.startedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </p>
            </div>
            {!practising && data.questions.some(practisable) && <Button onClick={() => setPractising(true)}>Practise these questions</Button>}
          </div>
          {practising ? <Practice questions={data.questions.filter(practisable)} onStop={() => setPractising(false)} /> : <Answers questions={data.questions} />}
        </div>
      )}
    </Shell>
  );
}

const practisable = (q: ReviewQuestion) => q.type === "choice" && q.correctIndex !== null;

function Answers({ questions }: { questions: ReviewQuestion[] }) {
  return (
    <div className="grid gap-4">
      {questions.map((q, i) => (
        <Card key={q.id} className="gap-3">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="text-muted-foreground">{i + 1}.</span> {q.prompt}
              {q.mine && !q.mine.counted && <Badge variant="outline" className="border-amber-300 text-amber-800">not counted</Badge>}
              {!q.mine && <Badge variant="outline">no answer</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {q.type === "open" ? (
              <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">{q.mine?.text ?? "You didn't answer this one."}</p>
            ) : (
              q.options.map((o, oi) => {
                const mine = q.mine?.choice === oi;
                const correct = q.correctIndex === oi;
                return (
                  <div
                    key={oi}
                    className={cn("flex items-center gap-3 rounded-md border p-2.5 text-sm", correct && "border-green-600 bg-green-600/10", mine && !correct && q.correctIndex !== null && "border-red-500 bg-red-500/10")}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded border font-semibold">{letter(oi)}</span>
                    <span className="flex-1">{o}</span>
                    {mine && (
                      <span className="text-xs text-muted-foreground">
                        your answer{q.mine?.confidence !== null && q.mine?.confidence !== undefined ? ` · ${q.mine.confidence}% sure` : ""}
                      </span>
                    )}
                    {correct && <CheckCircle2 className="size-4 text-green-600" />}
                  </div>
                );
              })
            )}
            {q.type === "choice" && q.correctIndex === null && <p className="text-xs text-muted-foreground">Poll: no right answer.</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Untimed retake with instant feedback. Nothing is sent to the server. */
function Practice({ questions, onStop }: { questions: ReviewQuestion[]; onStop: () => void }) {
  const [round, setRound] = useState(0);
  const order = useMemo(() => shuffle(questions.map((q) => ({ q, options: shuffle(q.options.map((text, index) => ({ text, index }))) }))), [questions, round]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);

  if (i >= order.length)
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {right} of {order.length} right
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button
            onClick={() => {
              setRound((r) => r + 1);
              setI(0);
              setRight(0);
              setPicked(null);
            }}
          >
            <RotateCcw /> Again
          </Button>
          <Button variant="outline" onClick={onStop}>
            Back to answers
          </Button>
        </CardContent>
      </Card>
    );

  const { q, options } = order[i]!;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Practice · {i + 1} of {order.length}
        </span>
        <Button variant="ghost" size="sm" onClick={onStop}>
          Stop
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-xl font-semibold">{q.prompt}</p>
        <div className="grid gap-2">
          {options.map((o) => {
            const show = picked !== null;
            return (
              <button
                key={o.index}
                disabled={show}
                onClick={() => {
                  setPicked(o.index);
                  if (o.index === q.correctIndex) setRight((r) => r + 1);
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors hover:bg-muted",
                  show && o.index === q.correctIndex && "border-green-600 bg-green-600/10",
                  show && o.index === picked && o.index !== q.correctIndex && "border-red-500 bg-red-500/10",
                )}
              >
                {o.text}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium">
              {picked === q.correctIndex ? <CheckCircle2 className="size-5 text-green-600" /> : <XCircle className="size-5 text-red-500" />}
              {picked === q.correctIndex ? "Right" : "Not quite"}
            </span>
            <Button
              onClick={() => {
                setPicked(null);
                setI((n) => n + 1);
              }}
            >
              {i + 1 < order.length ? "Next" : "Finish"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
