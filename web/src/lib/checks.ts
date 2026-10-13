import type { CheckAction, Checks } from "@/lib/api";

export const CHECK_LABELS: Record<keyof Checks, { title: string; help: string }> = {
  leftPage: { title: "Leaving the page", help: "Switching apps or tabs while a question is open." },
  splitScreen: { title: "Split screen", help: "Using the quiz next to another app." },
  connectionLost: { title: "Connection lost", help: "The phone dropped offline during a question. Often just bad wifi." },
};

export const ACTION_LABELS: Record<CheckAction, string> = {
  disqualify: "Answer doesn't count",
  warn: "Warn student, answer counts",
  record: "Record silently",
};

export const REVIEW_LABELS = {
  never: "Students can't review",
  "after-session": "Students can review after the session",
} as const;

export const CHECK_KEYS = Object.keys(CHECK_LABELS) as (keyof Checks)[];
