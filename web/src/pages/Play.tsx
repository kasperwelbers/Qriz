import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Centered } from "@/components/Shell";
import { useCountdown, useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

const COLORS = ["bg-red-500", "bg-blue-500", "bg-amber-500", "bg-green-600", "bg-purple-500", "bg-pink-500"];

/** The student's phone during a quiz: the options in a per-student order and a timer, never the question text. */
export default function Play() {
  const { runId = "" } = useParams();
  const { state, error, connected, send, offset } = useLive(runId, "student");
  const left = useCountdown(state?.phase === "question" ? state.deadline : undefined, offset);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => setPicked(null), [state?.questionId]);

  // Split screen keeps focus while the other half is read, so check the window size instead.
  const [split, setSplit] = useState(isSplitScreen);
  const inQuestion = state?.phase === "question";
  useEffect(() => {
    // Already split when the question starts: the buttons stay disabled until it's closed.
    // Switching to split screen during the question disqualifies, like leaving the page.
    setSplit(isSplitScreen());
    const check = () => {
      const now = isSplitScreen();
      setSplit(now);
      if (now && inQuestion) send({ type: "focus", state: "hidden", reason: "split screen" });
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [send, inQuestion]);

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
    if (state.phase === "paper")
      return <Message title="Time's up" text={answer !== null ? "Your answer is locked in. The right answer comes up in a moment." : "You didn't answer this one."} />;
    if (state.phase === "closed") {
      const correct = state.correctIndex;
      const right = !state.disqualified && answer !== null && answer === correct;
      return (
        <Message
          icon={right ? <CheckCircle2 className="size-12 text-green-600" /> : <XCircle className="size-12 text-red-500" />}
          title={state.disqualified ? "Not counted" : answer === null ? "No answer" : right ? "Correct" : "Not quite"}
          text={correct !== null ? `The answer was: ${state.choices?.find((c) => c.index === correct)?.text}` : "Wait for the next question."}
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
          <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-600">You left the app or used split screen during this question, so your answer won't count.</p>
        )}
        <div className="flex flex-1 flex-col gap-3">
          {state.choices?.map((c, i) => (
            <button
              key={c.index}
              disabled={answer !== null || left <= 0 || split}
              onClick={() => {
                setPicked(c.index);
                send({ type: "answer", questionId: state.questionId, choice: c.index });
              }}
              className={cn(
                "flex min-h-16 flex-1 items-center rounded-2xl px-5 py-3 text-left text-xl font-semibold text-white transition-opacity",
                COLORS[i],
                answer !== null && answer !== c.index && "opacity-25",
                answer === c.index && "ring-4 ring-foreground ring-offset-2",
              )}
            >
              {c.text}
            </button>
          ))}
        </div>
        <p className="h-5 text-center text-sm text-muted-foreground">{answer !== null ? "Answer locked in" : error}</p>
      </div>
    );
  })();

  return (
    <div className="flex min-h-dvh flex-col p-4 select-none" onContextMenu={(e) => e.preventDefault()}>
      {!connected && <p className="mb-2 text-center text-sm text-amber-600">Reconnecting…</p>}
      {split && state.kind === "quiz" && state.phase !== "ended" && (
        <p className="mb-3 rounded-md bg-amber-500/10 p-3 text-center text-sm text-amber-700">Close split screen and use this page full screen to answer.</p>
      )}
      {body}
    </div>
  );
}

/**
 * True when the page fills well under the screen, as with split screen or a floating window.
 * A full-screen mobile browser uses ~75-90% of the screen area (address and nav bars take the rest).
 */
function isSplitScreen() {
  const ratio = (window.innerWidth * window.innerHeight) / (screen.width * screen.height);
  return ratio < 0.55;
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
