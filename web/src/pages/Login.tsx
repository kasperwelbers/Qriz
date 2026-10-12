import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Centered } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get("next") ?? "/";
  const joining = params.get("title");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(params.get("expired") ? "That login link has expired. Request a new code." : "");
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ loginId: string }>("/auth/start", { body: { email, next } });
      setLoginId(r.loginId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/verify", { body: { loginId, code } });
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{joining ? `Log in to join "${joining}"` : "Log in to ClassQuiz"}</CardTitle>
          <CardDescription>
            {loginId ? `We sent a 6-digit code to ${email}. You stay logged in on this device afterwards.` : "Use your university email address. We'll send you a login code."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!loginId ? (
            <form onSubmit={start} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy}>
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  className="text-center text-2xl tracking-[0.5em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy || code.length !== 6}>
                Log in
              </Button>
              <Button type="button" variant="ghost" onClick={() => (setLoginId(null), setCode(""))}>
                Use a different email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </Centered>
  );
}
