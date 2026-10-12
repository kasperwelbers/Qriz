import { useEffect, useRef, useState } from "react";

export type LiveState = {
  type: "state";
  kind: "attendance" | "quiz";
  title: string;
  phase: "lobby" | "question" | "closed" | "ended";
  qIndex: number;
  total: number;
  deadline: number;
  serverNow: number;
  timeLimitSec: number;
  optionCount: number;
  questionId: string | null;
  correctIndex: number | null;
  // student only: options in this student's own order, with their original index
  choices?: { index: number; text: string }[];
  myAnswer?: number | null;
  disqualified?: boolean;
  // presenter only
  prompt?: string | null;
  options?: string[];
  counts?: number[];
  answeredCount?: number;
  disqualifiedCount?: number;
  checkinCount?: number;
  connectedStudents?: number;
};

/** Live run connection with automatic reconnect. `offset` maps server time to local time. */
export function useLive(runId: string, as: "presenter" | "student") {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const offset = useRef(0);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/runs/${runId}${as === "presenter" ? "?as=presenter" : ""}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "state") {
          offset.current = msg.serverNow - Date.now();
          setState(msg);
          setError(null);
        } else if (msg.type === "error") setError(msg.error);
      };
      ws.onclose = (e) => {
        setConnected(false);
        if (stopped || e.reason === "ended") return;
        if (e.code === 4401 || e.code === 4403) return setError(e.code === 4401 ? "Please log in again." : "Scan the QR code to join first.");
        retry = setTimeout(connect, 1000);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [runId, as]);

  const send = (msg: unknown) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));
  return { state, error, connected, send, offset };
}

/** Seconds left until a server-time deadline, updated several times per second. */
export function useCountdown(deadline: number | undefined, offset: { current: number }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!deadline) return setLeft(0);
    const tick = () => setLeft(Math.max(0, (deadline - (Date.now() + offset.current)) / 1000));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline, offset]);
  return left;
}
