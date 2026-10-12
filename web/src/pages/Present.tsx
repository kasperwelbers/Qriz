import { ChevronRight, Maximize, QrCode, Square, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { api, letter, useMe } from "@/lib/api";
import { useCountdown, useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

function RotatingQr({ runId, size }: { runId: string; size: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const load = () =>
      api<{ url: string; rotateMs: number }>(`/teacher/runs/${runId}/qr`).then(
        (r) => {
          if (stopped) return;
          setUrl(r.url);
          timer = setTimeout(load, r.rotateMs);
        },
        () => !stopped && (timer = setTimeout(load, 2000)),
      );
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);
  if (!url) return <div style={{ width: size, height: size }} />;
  // Low error correction keeps the code sparse, which phones scan faster from a projector.
  return (
    <div className="rounded-xl bg-white p-4">
      <QRCode value={url} size={size} level="L" />
    </div>
  );
}

export default function Present() {
  const { runId = "" } = useParams();
  const me = useMe();
  const { state, connected, offset } = useLive(runId, "presenter");
  const left = useCountdown(state?.phase === "question" ? state.deadline : undefined, offset);
  const [showQr, setShowQr] = useState(false);

  if (me === null) return <Navigate to="/login" replace />;
  if (!state) return <div className="flex min-h-dvh items-center justify-center text-muted-foreground">{connected ? "Loading…" : "Connecting…"}</div>;

  const action = (a: "next" | "close" | "end") => api(`/teacher/runs/${runId}/${a}`, { method: "POST" }).catch((e) => alert(e.message));
  const qrVisible = state.phase === "lobby" || state.kind === "attendance" || showQr;
  const isLast = state.qIndex >= state.total - 1;

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3">
        <h1 className="mr-auto text-lg font-semibold">{state.title}</h1>
        <span className="flex items-center gap-1.5 text-sm text-white/70">
          <Users className="size-4" /> {state.checkinCount} checked in
        </span>
        {state.kind === "quiz" && state.phase !== "lobby" && state.phase !== "ended" && (
          <Button variant="secondary" size="sm" onClick={() => setShowQr((v) => !v)}>
            <QrCode /> {showQr ? "Hide QR" : "Show QR"}
          </Button>
        )}
        {state.kind === "quiz" && (state.phase === "lobby" || state.phase === "closed") && !isLast && (
          <Button size="sm" variant="secondary" onClick={() => action("next")}>
            {state.phase === "lobby" ? "Start quiz" : "Next question"} <ChevronRight />
          </Button>
        )}
        {state.phase === "question" && (
          <Button size="sm" variant="secondary" onClick={() => action("close")}>
            <Square /> Stop timer
          </Button>
        )}
        {state.phase !== "ended" && (
          <Button size="sm" variant="destructive" onClick={() => confirm("End this session? Students can no longer join or answer.") && action("end")}>
            End session
          </Button>
        )}
        <Button size="icon" variant="ghost" aria-label="Full screen" onClick={() => document.documentElement.requestFullscreen?.()}>
          <Maximize />
        </Button>
      </header>

      <main className="flex flex-1 items-center justify-center gap-12 p-8">
        {state.phase === "ended" ? (
          <div className="grid justify-items-center gap-4 text-center">
            <p className="text-3xl font-semibold">Session ended</p>
            <Button variant="secondary" asChild>
              <Link to={`/results/${runId}`}>View results</Link>
            </Button>
          </div>
        ) : (
          <>
            {state.phase !== "lobby" && state.kind === "quiz" && (
              <div className="grid max-w-4xl flex-1 gap-8">
                <div className="flex items-baseline justify-between text-white/60">
                  <span>
                    Question {state.qIndex + 1} of {state.total}
                  </span>
                  <span className={cn("text-6xl font-bold tabular-nums text-white", state.phase === "question" && left <= 5 && "text-red-400")}>
                    {state.phase === "question" ? Math.ceil(left) : ""}
                  </span>
                </div>
                <p className="text-4xl leading-tight font-semibold whitespace-pre-wrap">{state.prompt}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {state.options?.map((o, i) => {
                    const total = state.counts?.reduce((a, b) => a + b, 0) || 1;
                    const pct = Math.round(((state.counts?.[i] ?? 0) / total) * 100);
                    const reveal = state.phase === "closed";
                    return (
                      <div
                        key={i}
                        className={cn(
                          "relative flex items-center gap-4 overflow-hidden rounded-xl border border-white/15 p-5 text-2xl",
                          reveal && state.correctIndex === i && "border-green-400 bg-green-500/15",
                        )}
                      >
                        {reveal && <div className="absolute inset-y-0 left-0 bg-white/10" style={{ width: `${pct}%` }} />}
                        <span className="relative flex size-12 shrink-0 items-center justify-center rounded-lg bg-white text-2xl font-bold text-neutral-950">{letter(i)}</span>
                        <span className="relative">{o}</span>
                        {reveal && <span className="relative ml-auto text-lg text-white/70">{state.counts?.[i] ?? 0}</span>}
                      </div>
                    );
                  })}
                </div>
                <p className="text-white/60">
                  {state.answeredCount} answered
                  {state.disqualifiedCount ? ` · ${state.disqualifiedCount} left the app` : ""} · {state.connectedStudents} connected
                </p>
              </div>
            )}
            {qrVisible && (
              <div className="grid justify-items-center gap-4 text-center">
                <RotatingQr runId={runId} size={state.phase === "lobby" || state.kind === "attendance" ? 420 : 200} />
                {(state.phase === "lobby" || state.kind === "attendance") && (
                  <p className="text-2xl">{state.kind === "quiz" ? "Scan to join the quiz" : "Scan to check in"}</p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
