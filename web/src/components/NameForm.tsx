import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Centered } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Me } from "@/lib/api";

export function NameForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/auth/name", { body: { name } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Centered>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>What's your name?</CardTitle>
          <CardDescription>This is shown on the screen in class when you check in. You only need to enter it once.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="name" required minLength={2} maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit">Continue</Button>
          </form>
        </CardContent>
      </Card>
    </Centered>
  );
}

/** Shows the name form first for students who haven't set a name yet. */
export function NameGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const load = () => api<{ user: Me }>("/auth/me").then((r) => setMe(r.user), () => setMe(null));
  useEffect(() => {
    load();
  }, []);
  if (me === undefined) return null;
  if (me && !me.name) return <NameForm onDone={load} />;
  return <>{children}</>;
}
