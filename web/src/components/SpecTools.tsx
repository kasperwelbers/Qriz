import { Check, Sparkles } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { aiPrompt, type SpecError } from "@shared/spec";
import { Button } from "@/components/ui/button";

/** Monaco is large, so it only loads on pages that show a YAML editor. */
export const LazyYamlEditor = lazy(() => import("@/components/YamlEditor"));

export function YamlEditorFallback() {
  return <div className="flex h-[65vh] items-center justify-center rounded-md border text-sm text-muted-foreground">Loading editor…</div>;
}

export function SuspendedYamlEditor(props: React.ComponentProps<typeof LazyYamlEditor>) {
  return (
    <Suspense fallback={<YamlEditorFallback />}>
      <LazyYamlEditor {...props} />
    </Suspense>
  );
}

/** Copies instructions plus an example, so a teacher can ask any AI chat for questions in the right format. */
export function CopyAiPrompt({ kind }: { kind: "task" | "course" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title="Copies instructions and an example. Paste it into an AI chat, add what you want, and paste the answer back here."
      onClick={async () => {
        await navigator.clipboard.writeText(aiPrompt(kind));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check /> : <Sparkles />} {copied ? "Copied" : "Copy AI prompt"}
    </Button>
  );
}

export function SpecErrors({ errors, onPick }: { errors: SpecError[]; onPick?: (line: number) => void }) {
  if (!errors.length) return null;
  return (
    <ul className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      {errors.map((e, i) => (
        <li key={i}>
          {e.line !== null && onPick ? (
            <button type="button" className="mr-2 font-mono underline-offset-2 hover:underline" onClick={() => onPick(e.line!)}>
              line {e.line}
            </button>
          ) : null}
          {e.message}
        </li>
      ))}
    </ul>
  );
}
