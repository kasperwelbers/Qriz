# ClassQuiz

In-class attendance checks and quick quizzes that are hard to do from home or with AI.

- **Rotating QR check-in.** The projector shows a QR code that changes every 2 seconds. Each code carries a server-signed timestamp and is only accepted for 15 seconds, so a photo sent to an absent friend is useless. The server records the QR timestamp, the scan time and a per-browser device id; one phone checking in several accounts is flagged as `shared-device`.
- **Teacher-paced quizzes.** Questions and options appear only on the projector. Phones show only the answer letters and a countdown, so there is nothing on the phone to copy, screenshot or paste into an AI.
- **Focus rule.** If a student leaves the page during a question (app switch, blur, or the connection dropping), that answer is disqualified. The server enforces deadlines; the client only reports.
- **Magic-link / code login.** Students log in with their university email and a 6-digit code (or the emailed link) and stay logged in on that device for 180 days. A student who scans before logging in keeps their scan for 10 minutes while they log in.

## Stack

Bun + Hono server, SQLite through Drizzle (`bun:sqlite`), WebSockets via `hono/bun`, Vite + React + Tailwind v4 + shadcn/ui. One process holds the live quiz state in memory, which is why it runs on a single VPS rather than a serverless platform.

## Development

```sh
bun install
TEACHER_EMAILS=you@uni.nl bun run dev   # API on :3000, Vite on :5173 (proxied)
```

Open http://localhost:5173 and log in with the teacher address. Without `SMTP_URL`, login codes are printed in the server log. To test on a phone on the same network, set `PUBLIC_URL=http://<your-ip>:5173`.

After changing `server/db/schema.ts`, run `bun run db:generate`; migrations are applied on startup.

## Deploying on a VPS

```sh
cp .env.example .env    # fill in PUBLIC_URL, APP_SECRET, domains, teachers, SMTP
# set your domain in Caddyfile
docker compose up -d --build
```

The database lives in the `data` volume. Back it up with `sqlite3 /data/classquiz.db ".backup ..."` or by copying the volume while the app is stopped.

## Layout

```
server/
  index.ts     routes, WebSocket endpoint, static files in production
  auth.ts      email code / link login, sessions, device id
  routes.ts    teacher tasks & runs, QR tokens, student join, results & CSV
  live.ts      in-memory live run: phases, timers, answers, focus rule
  db/          Drizzle schema and connection
web/src/
  pages/       Dashboard, TaskEditor, Present (projector), Join, Play (phone), Results
  components/  shadcn/ui components
```

## Not built yet

- Canvas integration (roster import, grade passback via the teacher's OAuth token).
- Data retention: deleting runs after a course ends.
