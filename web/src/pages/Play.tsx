import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Centered } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCountdown, useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

const COLORS = ["bg-red-500", "bg-blue-500", "bg-amber-500", "bg-green-600", "bg-purple-500", "bg-pink-500"];

/** The student's phone during a quiz: the options in a per-student order and a timer, never the question text. */
export default function Play() {
  const { runId = "" } = useParams();
  const { state, error, connected, send, offset } = useLive(runId, "student");
  const left = useCountdown(state?.phase === "question" ? state.deadline : undefined, offset);
  const [picked, setPicked] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [text, setText] = useState("");

  useEffect(() => {
    setPicked(null);
    setConfidence(50);
    setText("");
  }, [state?.questionId]);

  // Split screen keeps focus while the other half is read, so check the window size instead.
  const [split, setSplit] = useState(isSplitScreen);
  const inQuestion = state?.phase === "question";
  const splitBlocks = state?.splitScreenBlocks ?? true;
  useEffect(() => {
    // When split screen disqualifies: already split at the start only disables the buttons until it's closed,
    // switching to it during the question disqualifies. Otherwise it is reported either way and the teacher's
    // settings decide what it means.
    const now = isSplitScreen();
    setSplit(now);
    if (now && inQuestion && !splitBlocks) send({ type: "focus", state: "hidden", reason: "split screen" });
    const check = () => {
      // The on-screen keyboard shrinks the window on some phones; that's not split screen.
      if (isTyping()) return;
      const now = isSplitScreen();
      setSplit(now);
      if (now && inQuestion) send({ type: "focus", state: "hidden", reason: "split screen" });
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [send, inQuestion, splitBlocks]);

  // Leaving the page during a question is reported; the server applies the teacher's setting.
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

  const answered = state.answered ?? false;
  const answer = state.myAnswer ?? picked;
  const blocked = split && splitBlocks;
  const submitChoice = (index: number, conf?: number) =>
    send({ type: "answer", questionId: state.questionId, choice: index, ...(conf !== undefined && { confidence: conf }) });

  const body = (() => {
    if (state.phase === "ended") return <Message title="Session ended" text="Thanks for taking part." />;
    if (state.kind === "attendance") return <Message icon={<CheckCircle2 className="size-12 text-green-600" />} title="You're checked in" text={state.title} />;
    if (state.phase === "lobby") return <Message title="You're in" text="Keep this page open. The first question will appear on the screen." />;
    if (state.phase === "paper")
      return <Message title="Time's up" text={answered ? "Your answer is locked in. The right answer comes up in a moment." : "You didn't answer this one."} />;
    if (state.phase === "closed") {
      if (state.disqualified) return <Message icon={<XCircle className="size-12 text-red-500" />} title="Not counted" text="Wait for the next question." />;
      if (!answered) return <Message title="No answer" text="Wait for the next question." />;
      if (state.qType === "open") return <Message icon={<CheckCircle2 className="size-12 text-green-600" />} title="Thanks, your answer is in" text={state.myText ?? ""} />;
      const correct = state.correctIndex;
      if (correct === null) return <Message icon={<CheckCircle2 className="size-12 text-green-600" />} title="Answer counted" text="Wait for the next question." />;
      const right = answer === correct;
      return (
        <Message
          icon={right ? <CheckCircle2 className="size-12 text-green-600" /> : <XCircle className="size-12 text-red-500" />}
          title={right ? "Correct" : "Not quite"}
          text={`The answer was: ${state.choices?.find((c) => c.index === correct)?.text}`}
        />
      );
    }

    const confirmingConfidence = state.askConfidence && picked !== null && !answered;
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
        {!state.disqualified && !!state.warnings?.length && (
          <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700">
            Noticed: {state.warnings.join(", ")}. Your answer still counts, but your teacher can see this.
          </p>
        )}

        {state.qType === "open" ? (
          <form
            className="flex flex-1 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              send({ type: "answer", questionId: state.questionId, text });
            }}
          >
            <Textarea
              value={answered ? (state.myText ?? "") : text}
              disabled={answered || left <= 0 || blocked}
              maxLength={500}
              placeholder="Type your answer"
              className="min-h-40 flex-1 text-lg"
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" size="lg" disabled={answered || left <= 0 || blocked || !text.trim()}>
              Send
            </Button>
          </form>
        ) : confirmingConfidence ? (
          <div className="flex flex-1 flex-col justify-center gap-6">
            <p className={cn("rounded-2xl px-5 py-4 text-xl font-semibold text-white", COLORS[state.choices?.findIndex((c) => c.index === picked) ?? 0])}>
              {state.choices?.find((c) => c.index === picked)?.text}
            </p>
            <div className="grid gap-3">
              <p className="text-lg font-medium">How sure are you?</p>
              <input type="range" min={0} max={100} step={10} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="w-full accent-primary" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Guessing</span>
                <span className="font-medium text-foreground">{confidence}%</span>
                <span>Certain</span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setPicked(null)}>
                Back
              </Button>
              <Button size="lg" className="flex-1" disabled={left <= 0 || blocked} onClick={() => submitChoice(picked, confidence)}>
                Lock in
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3">
            {state.choices?.map((c, i) => (
              <button
                key={c.index}
                disabled={answered || left <= 0 || blocked}
                onClick={() => {
                  setPicked(c.index);
                  if (!state.askConfidence) submitChoice(c.index);
                }}
                className={cn(
                  "flex min-h-16 flex-1 items-center rounded-2xl px-5 py-3 text-left text-xl font-semibold text-white transition-opacity",
                  COLORS[i],
                  answered && answer !== c.index && "opacity-25",
                  answered && answer === c.index && "ring-4 ring-foreground ring-offset-2",
                )}
              >
                {c.text}
              </button>
            ))}
          </div>
        )}
        <p className="h-5 text-center text-sm text-muted-foreground">{answered ? "Answer locked in" : error}</p>
      </div>
    );
  })();

  return (
    <div className="flex min-h-dvh flex-col p-4 select-none" onContextMenu={(e) => e.preventDefault()}>
      {!connected && <p className="mb-2 text-center text-sm text-amber-600">Reconnecting…</p>}
      {blocked && state.kind === "quiz" && state.phase !== "ended" && (
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

function isTyping() {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
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
