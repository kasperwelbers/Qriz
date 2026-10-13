import { Editor, loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { configureMonacoYaml } from "monaco-yaml";
import YamlWorker from "monaco-yaml/yaml.worker?worker";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { CourseSpec, type SpecError, TaskSpec } from "@shared/spec";

// Monaco is bundled with the app instead of loaded from a CDN, so nothing leaves the university server.
window.MonacoEnvironment = { getWorker: (_, label) => (label === "yaml" ? new YamlWorker() : new EditorWorker()) };
loader.config({ monaco });
configureMonacoYaml(monaco, {
  enableSchemaRequest: false,
  // Our own Zod check reports errors (with friendlier messages); the schema is only used for autocomplete and hover help.
  validate: false,
  schemas: [
    { uri: "inmemory://qriz/course.schema.json", fileMatch: ["**/course.yaml"], schema: z.toJSONSchema(CourseSpec, { io: "input", unrepresentable: "any" }) as never },
    { uri: "inmemory://qriz/task.schema.json", fileMatch: ["**/task.yaml"], schema: z.toJSONSchema(TaskSpec, { io: "input", unrepresentable: "any" }) as never },
  ],
});

/** YAML editor with autocomplete from the course/task schema and our validation errors shown inline. */
export default function YamlEditor({
  kind,
  value,
  onChange,
  errors,
  revealLine,
}: {
  kind: "course" | "task";
  value: string;
  onChange: (v: string) => void;
  errors: SpecError[];
  /** Bump to scroll to a line, e.g. when an error in the list is clicked. */
  revealLine?: { line: number; n: number } | null;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "qriz",
      errors
        .filter((e) => e.line !== null && e.line <= model.getLineCount())
        .map((e) => ({
          severity: monaco.MarkerSeverity.Error,
          message: e.message,
          startLineNumber: e.line!,
          endLineNumber: e.line!,
          startColumn: model.getLineFirstNonWhitespaceColumn(e.line!) || 1,
          endColumn: model.getLineMaxColumn(e.line!),
        })),
    );
  }, [errors, value]);

  useEffect(() => {
    if (!revealLine || !editorRef.current) return;
    editorRef.current.revealLineInCenter(revealLine.line);
    editorRef.current.setPosition({ lineNumber: revealLine.line, column: 1 });
    editorRef.current.focus();
  }, [revealLine]);

  return (
    <div className="overflow-hidden rounded-md border">
      <Editor
        height="65vh"
        path={`${kind}.yaml`}
        language="yaml"
        theme={dark ? "vs-dark" : "light"}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={onMount}
        options={{ minimap: { enabled: false }, fontSize: 14, tabSize: 2, wordWrap: "on", scrollBeyondLastLine: false, quickSuggestions: { other: true, strings: true } }}
      />
    </div>
  );
}
