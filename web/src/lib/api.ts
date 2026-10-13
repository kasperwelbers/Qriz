import type { QuestionData } from "@shared/spec";
export type { TaskData } from "@shared/spec";
import { useEffect, useState } from "react";

export type Me = { id: string; email: string; role: "teacher" | "student"; name: string | null } | null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export function useMe() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    api<{ user: Me }>("/auth/me").then((r) => setMe(r.user), () => setMe(null));
  }, []);
  return me;
}

export const letter = (i: number) => String.fromCharCode(65 + i);

export type Question = QuestionData;

export type CheckAction = "disqualify" | "warn" | "record";
export type Checks = { leftPage: CheckAction; splitScreen: CheckAction; connectionLost: CheckAction };
export const defaultChecks: Checks = { leftPage: "disqualify", splitScreen: "disqualify", connectionLost: "record" };
export type Run = { id: string; taskId: string; startedAt: number; endedAt: number | null };
export type CourseDefaults = { review?: "never" | "after-session"; checks?: Partial<Checks> };
export type CourseSummary = { id: string; title: string; taskCount: number; shared: boolean; createdAt: number };
export type CourseTask = { id: string; title: string; kind: "attendance" | "quiz"; review: "never" | "after-session" | null; questionCount: number; runs: Run[] };
export type CourseDetail = { id: string; title: string; teachers: string[]; defaults: CourseDefaults; isOwner: boolean; tasks: CourseTask[] };
