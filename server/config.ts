const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const isProd = process.env.NODE_ENV === "production";

const secret = process.env.APP_SECRET ?? (isProd ? undefined : "dev-secret-change-me-dev-secret-change-me");
if (!secret || secret.length < 32) throw new Error("APP_SECRET must be set to at least 32 characters");

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  /** Public URL of the app, used in QR codes and login emails. */
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  secret,
  databasePath: process.env.DATABASE_PATH ?? "./data/classquiz.db",
  /** Only these email domains may log in. Empty means any domain (dev only). */
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),
  /** These addresses get the teacher role. */
  teacherEmails: list(process.env.TEACHER_EMAILS),
  sessionDays: Number(process.env.SESSION_DAYS ?? 180),
  /** How old a scanned QR timestamp may be. Covers display lag, camera focus and the tap to open the link. */
  qrMaxAgeMs: Number(process.env.QR_MAX_AGE_MS ?? 8_000),
  /** Scans slower than this are accepted but flagged for the teacher. Forwarding a photo usually takes longer. */
  qrSlowScanMs: Number(process.env.QR_SLOW_SCAN_MS ?? 5_000),
  qrRotateMs: Number(process.env.QR_ROTATE_MS ?? 2_000),
  /** Time a student has to finish logging in after scanning a valid code. */
  pendingJoinMs: Number(process.env.PENDING_JOIN_MS ?? 10 * 60_000),
  /** Grace period on question deadlines for network latency. */
  answerGraceMs: 750,
  /** Length of the optional paper round after phones lock. */
  paperSeconds: Number(process.env.PAPER_SECONDS ?? 20),
  smtp: process.env.SMTP_URL ? { url: process.env.SMTP_URL, from: process.env.SMTP_FROM ?? "ClassQuiz <noreply@localhost>" } : null,
};
