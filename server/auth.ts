import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { config } from "./config.ts";
import { randomCode, randomId, randomToken, safeEqual, sha256 } from "./crypto.ts";
import { db, schema } from "./db/index.ts";
import { refreshPresentersFor } from "./live.ts";
import { sendLoginEmail } from "./mail.ts";

export type User = typeof schema.users.$inferSelect;
export type AppEnv = { Variables: { user: User | null } };

const SESSION_COOKIE = "sid";
const DEVICE_COOKIE = "did";
const LOGIN_TTL_MS = 15 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

const cookieOpts = {
  httpOnly: true,
  secure: config.publicUrl.startsWith("https://"),
  sameSite: "Lax" as const,
  path: "/",
};

/** A random per-browser id, used to spot one phone checking in for several accounts. */
export function deviceId(c: Context): string {
  let id = getCookie(c, DEVICE_COOKIE);
  if (!id || !/^[\w-]{16,64}$/.test(id)) {
    id = randomToken(16);
    setCookie(c, DEVICE_COOKIE, id, { ...cookieOpts, maxAge: 400 * 86400 });
  }
  return id;
}

export function userForSessionToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.idHash, sha256(token)), gt(schema.sessions.expiresAt, Date.now())))
    .get();
  return row?.user ?? null;
}

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", userForSessionToken(getCookie(c, SESSION_COOKIE)));
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return c.json({ error: "unauthenticated" }, 401);
  await next();
});

export const requireTeacher = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  if (user.role !== "teacher") return c.json({ error: "forbidden" }, 403);
  await next();
});

const recentLogins = new Map<string, number[]>();

/** Small in-memory limiter so the login form can't be used to spam inboxes. */
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (recentLogins.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  recentLogins.set(key, hits);
  return hits.length > max;
}

export function emailAllowed(email: string): boolean {
  if (config.allowedEmailDomains.length === 0) return true;
  const domain = email.split("@")[1] ?? "";
  return config.allowedEmailDomains.includes(domain);
}

export function upsertUser(email: string): User {
  const role = config.teacherEmails.includes(email) ? "teacher" : "student";
  const existing = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (existing) {
    if (role === "teacher" && existing.role !== "teacher") {
      db.update(schema.users).set({ role }).where(eq(schema.users.id, existing.id)).run();
      return { ...existing, role };
    }
    return existing;
  }
  return db.insert(schema.users).values({ id: randomId(), email, role }).returning().get();
}

function startSession(c: Context, user: User) {
  const token = randomToken();
  const maxAge = config.sessionDays * 86400;
  db.insert(schema.sessions)
    .values({
      idHash: sha256(token),
      userId: user.id,
      expiresAt: Date.now() + maxAge * 1000,
      userAgent: c.req.header("user-agent")?.slice(0, 300),
    })
    .run();
  setCookie(c, SESSION_COOKIE, token, { ...cookieOpts, maxAge });
}

export const authRoutes = new Hono<AppEnv>()
  .get("/me", (c) => {
    const user = c.get("user");
    return c.json({ user: user && { id: user.id, email: user.email, role: user.role, name: user.name } });
  })

  .post("/start", async (c) => {
    const body = await c.req.json<{ email?: string; next?: string }>().catch(() => ({}) as { email?: string; next?: string });
    const email = body.email?.trim().toLowerCase() ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "Enter a valid email address" }, 400);
    if (!emailAllowed(email)) return c.json({ error: "Use your university email address" }, 400);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimited(`email:${email}`, 5, 15 * 60_000) || rateLimited(`ip:${ip}`, 30, 15 * 60_000))
      return c.json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);

    const id = randomId();
    const code = randomCode();
    const linkToken = randomToken();
    db.insert(schema.loginRequests)
      .values({ id, email, codeHash: sha256(`${id}:${code}`), linkHash: sha256(linkToken), expiresAt: Date.now() + LOGIN_TTL_MS })
      .run();

    const next = body.next?.startsWith("/") ? body.next : "/";
    const link = `${config.publicUrl}/api/auth/link/${linkToken}?next=${encodeURIComponent(next)}`;
    await sendLoginEmail(email, code, link);
    return c.json({ loginId: id });
  })

  .post("/verify", async (c) => {
    const { loginId, code } = await c.req.json<{ loginId: string; code: string }>();
    const req = db
      .select()
      .from(schema.loginRequests)
      .where(and(eq(schema.loginRequests.id, String(loginId)), isNull(schema.loginRequests.usedAt), gt(schema.loginRequests.expiresAt, Date.now())))
      .get();
    if (!req || req.attempts >= MAX_CODE_ATTEMPTS) return c.json({ error: "This code has expired. Request a new one." }, 400);

    if (!safeEqual(sha256(`${req.id}:${String(code).trim()}`), req.codeHash)) {
      db.update(schema.loginRequests).set({ attempts: req.attempts + 1 }).where(eq(schema.loginRequests.id, req.id)).run();
      return c.json({ error: "Wrong code" }, 400);
    }
    db.update(schema.loginRequests).set({ usedAt: Date.now() }).where(eq(schema.loginRequests.id, req.id)).run();
    const user = upsertUser(req.email);
    startSession(c, user);
    return c.json({ user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  })

  .get("/link/:token", (c) => {
    const req = db
      .select()
      .from(schema.loginRequests)
      .where(and(eq(schema.loginRequests.linkHash, sha256(c.req.param("token"))), isNull(schema.loginRequests.usedAt), gt(schema.loginRequests.expiresAt, Date.now())))
      .get();
    if (!req) return c.redirect("/login?expired=1");
    db.update(schema.loginRequests).set({ usedAt: Date.now() }).where(eq(schema.loginRequests.id, req.id)).run();
    startSession(c, upsertUser(req.email));
    const next = c.req.query("next");
    return c.redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  })

  .post("/name", requireUser, async (c) => {
    const { name } = await c.req.json<{ name?: string }>();
    const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (clean.length < 2) return c.json({ error: "Enter your name" }, 400);
    db.update(schema.users).set({ name: clean }).where(eq(schema.users.id, c.get("user")!.id)).run();
    refreshPresentersFor(c.get("user")!.id);
    return c.json({ ok: true });
  })

  .post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.delete(schema.sessions).where(eq(schema.sessions.idHash, sha256(token))).run();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
