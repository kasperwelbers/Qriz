import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { CourseSpec, parseSpec, type SpecError, toYaml } from "@shared/spec";
import { Shell } from "@/components/Shell";
import { CopyAiPrompt, SpecErrors, SuspendedYamlEditor } from "@/components/SpecTools";
import { Button } from "@/components/ui/button";
import { api, useMe } from "@/lib/api";

/** The whole course as one YAML document: the quickest way to write, copy and reorder many tasks at once. */
export default function CourseYaml() {
  const { id } = useParams();
  const me = useMe();
  const [yaml, setYaml] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [errors, setErrors] = useState<SpecError[]>([]);
  const [reveal, setReveal] = useState<{ line: number; n: number } | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (me?.role !== "teacher") return;
    api<CourseSpec>(`/teacher/courses/${id}/spec`).then((spec) => {
      const text = toYaml(spec);
      setYaml(text);
      setSaved(text);
    });
  }, [id, me]);

  useEffect(() => {
    if (yaml === null) return;
    const timer = setTimeout(() => setErrors(parseSpec(yaml, CourseSpec).errors), 300);
    return () => clearTimeout(timer);
  }, [yaml]);

  if (me === undefined) return null;
  if (me?.role !== "teacher") return <Navigate to="/" replace />;

  async function save() {
    if (yaml === null) return;
    const { data, errors } = parseSpec(yaml, CourseSpec);
    setErrors(errors);
    if (!data) return setStatus("");
    try {
      // The server answers with the saved course, including ids for new tasks.
      const spec = await api<CourseSpec>(`/teacher/courses/${id}/spec`, { method: "PUT", body: data });
      const text = toYaml(spec);
      setYaml(text);
      setSaved(text);
      setStatus("Saved");
    } catch (err) {
      setErrors([{ line: null, message: (err as Error).message }]);
      setStatus("");
    }
  }

  const dirty = yaml !== saved;

  return (
    <Shell me={me}>
      <div className="grid gap-4">
        <div>
          <Link to={`/courses/${id}`} className="text-sm text-muted-foreground hover:underline">
            ← Back to course
          </Link>
          <h1 className="text-2xl font-semibold">Edit course as YAML</h1>
          <p className="text-sm text-muted-foreground">
            Copy a task block to duplicate it (leave out its <code>id</code> line), reorder tasks by moving blocks, or paste questions from an AI chat. Press Ctrl+Space for
            suggestions. Past results are never changed.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={yaml === null || !dirty}>
              Save
            </Button>
            <span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes" : status}</span>
          </div>
          <CopyAiPrompt kind="course" />
        </div>
        {yaml !== null && (
          <SuspendedYamlEditor
            kind="course"
            value={yaml}
            onChange={(v) => {
              setYaml(v);
              setStatus("");
            }}
            errors={errors}
            revealLine={reveal}
          />
        )}
        <SpecErrors errors={errors} onPick={(line) => setReveal((r) => ({ line, n: (r?.n ?? 0) + 1 }))} />
      </div>
    </Shell>
  );
}
