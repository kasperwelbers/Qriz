import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Centered } from "@/components/Shell";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

type JoinResult = { needLogin?: boolean; title: string; runId?: string; kind?: "attendance" | "quiz" };

/** Landing page for a scanned QR code (or the return after logging in). */
export default function Join({ resume = false }: { resume?: boolean }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const req = resume ? api<JoinResult>("/join/resume", { method: "POST" }) : api<JoinResult>("/join", { body: { token } });
    req.then(
      (r) => {
        if (r.needLogin) navigate(`/login?next=${encodeURIComponent("/join/resume")}&title=${encodeURIComponent(r.title)}`, { replace: true });
        else if (r.kind === "quiz") navigate(`/play/${r.runId}`, { replace: true });
        else setDone(r.title);
      },
      (err) => setError(err.message),
    );
  }, [navigate, resume, token]);

  return (
    <Centered>
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="justify-items-center">
          {done ? (
            <>
              <CheckCircle2 className="size-12 text-green-600" />
              <CardTitle>You're checked in</CardTitle>
              <CardDescription>{done}</CardDescription>
            </>
          ) : error ? (
            <>
              <CardTitle>Could not join</CardTitle>
              <CardDescription>{error}</CardDescription>
            </>
          ) : (
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          )}
        </CardHeader>
      </Card>
    </Centered>
  );
}
