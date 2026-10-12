import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Centered } from "@/components/Shell";
import { letter } from "@/lib/api";
import { useCountdown, useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

const COLORS = ["bg-red-500", "bg-blue-500", "bg-amber-500", "bg-green-600", "bg-purple-500", "bg-pink-500"];

/** The student's phone during a quiz: only answer letters and a timer, never the question text. */
export default function Play() {
  const { runId = "" } = useParams();
  const { state, error, connected, send, offset } = useLive(runId, "student");
  const left = useCountdown(state?.phase === "question" ? state.deadline : undefined, offset);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => setPicked(null), [state?.questionId]);

  // Leaving the page during a question disqualifies the answer; the server decides, we only report.
  useEffect(() => {
    const report = () => send({ type: "focus", state: "hidden" });
    const onVisibility = () => document.visibilityState === "hidden" && report();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", report);
    window.addEventListener("pagehide", report);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", report);
      window.removeEventListener("pagehide", report);
    };
  }, [send]);

  if (error && !state) return <Centered><p className="text-center text-muted-foreground">{error}</p></Centered>;
  if (!state) return <Centered><Loader2 className="size-8 animate-spin text-muted-foreground" /></Centered>;

  const answer = state.myAnswer ?? picked;
  const body = (() => {
    if (state.phase === "ended") return <Message title="Session ended" text="Thanks for taking part." />;
    if (state.kind === "attendance") return <Message icon={<CheckCircle2 className="size-12 text-green-600" />} title="You're checked in" text={state.title} />;
    if (state.phase === "lobby") return <Message title="You're in" text="Keep this page open. The first question will appear on the screen." />;
    if (state.phase === "closed") {
      const correct = state.correctIndex;
      const right = !state.disqualified && answer !== null && answer === correct;
      return (
        <Message
          icon={right ? <CheckCircle2 className="size-12 text-green-600" /> : <XCircle className="size-12 text-red-500" />}
          title={state.disqualified ? "Not counted" : answer === null ? "No answer" : right ? "Correct" : "Not quite"}
          text={correct !== null ? `The answer was ${letter(correct)}.` : "Wait for the next question."}
        />
      );
    }
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">
            Question {state.qIndex + 1} / {state.total}
          </span>
          <span className={cn("text-4xl font-bold tabular-nums", left <= 5 && "text-red-500")}>{Math.ceil(left)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width] duration-200 ease-linear" style={{ width: `${(left / state.timeLimitSec) * 100}%` }} />
        </div>
        {state.disqualified && (
          <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-600">You left the app during this question, so your answer won't count.</p>
        )}
        <div className={cn("grid flex-1 gap-3", state.optionCount > 4 ? "grid-cols-2 grid-rows-3" : "grid-cols-2 grid-rows-2")}>
          {Array.from({ length: state.optionCount }, (_, i) => (
            <button
              key={i}
              disabled={answer !== null || left <= 0}
              onClick={() => {
                setPicked(i);
                send({ type: "answer", questionId: state.questionId, choice: i });
              }}
              className={cn(
                "rounded-2xl text-6xl font-bold text-white transition-opacity",
                COLORS[i],
                answer !== null && answer !== i && "opacity-25",
                answer === i && "ring-4 ring-foreground ring-offset-2",
              )}
            >
              {letter(i)}
            </button>
          ))}
        </div>
        <p className="h-5 text-center text-sm text-muted-foreground">{answer !== null ? `Answer ${letter(answer)} locked in` : error}</p>
      </div>
    );
  })();

  return (
    <div className="flex min-h-dvh flex-col p-4 select-none" onContextMenu={(e) => e.preventDefault()}>
      {!connected && <p className="mb-2 text-center text-sm text-amber-600">Reconnecting…</p>}
      {body}
    </div>
  );
}

function Message({ icon, title, text }: { icon?: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      {icon}
      <p className="text-2xl font-semibold">{title}</p>
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}
