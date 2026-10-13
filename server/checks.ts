/** Anti-cheat checks that fire during a question, and what the teacher wants to happen when they do. */
export const CHECKS = {
  leftPage: { label: "left the page", default: "disqualify" },
  splitScreen: { label: "split screen", default: "disqualify" },
  connectionLost: { label: "connection lost", default: "record" },
} as const;

export type Check = keyof typeof CHECKS;
/** disqualify: the answer doesn't count. warn: it counts, the student sees a warning, the teacher sees a flag. record: only the teacher sees a flag. */
export type CheckAction = "disqualify" | "warn" | "record";
export type CheckSettings = Record<Check, CheckAction>;

const ACTIONS: CheckAction[] = ["disqualify", "warn", "record"];

export function checkSettings(stored: Partial<Record<string, string>> | null | undefined): CheckSettings {
  const out = {} as CheckSettings;
  for (const [key, check] of Object.entries(CHECKS) as [Check, (typeof CHECKS)[Check]][]) {
    const v = stored?.[key];
    out[key] = ACTIONS.includes(v as CheckAction) ? (v as CheckAction) : check.default;
  }
  return out;
}
