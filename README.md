# Qriz

In-class attendance checks and quick quizzes that are hard to do from home or with AI.

- **Rotating QR check-in.** The projector shows a QR code that changes every 2 seconds. Each code carries a server-signed timestamp and is accepted for 8 seconds; scans slower than 5 seconds are accepted but flagged. Forwarding a photo to an absent friend takes longer than that.
- **Teacher-paced quizzes.** While phones can answer, the projector shows only the question. Phones show the answer options in a different random order for every student, plus a countdown. Nobody can signal "it's the 2nd one", and asking an AI means photographing the projector.
- **Paper round (optional, per session).** For students without a smartphone: after the phones lock, the projector shows the lettered options for a short extra window (`PAPER_SECONDS`, default 20) so they can write down a letter. The teacher enters those on the results page, which marks them present.
- **Focus rule.** If a student leaves the page during a question (app switch or blur), that answer is disqualified, even if they already answered. Split screen is caught by window size: switching to it mid-question disqualifies, and a phone already in split screen can't answer until it's closed. A dropped connection is only flagged, since classroom wifi can be flaky. The server enforces deadlines; the client only reports.
- **Per-check settings.** Each task chooses, per check (leaving the page, split screen, dropped connection), whether it disqualifies the answer, warns the student while the answer still counts, or is only recorded for the teacher. The defaults are as above.
- **Question types.** Multiple choice with a right answer, polls without one, and open answers (shown anonymously on the projector only when the teacher chooses). Each question earns a point for the right answer or for any answer in time, and can ask students how sure they are.
- **Participation history.** Students see where they were present and how many questions they answered, not a score.
- **Lobby headcount.** Before the quiz starts, the projector shows how many students checked in and their names (asked once at first login; the teacher can hide them). Seeing "Jan" on screen while Jan isn't there is the strongest deterrent against checking in for a friend.
- **Hints, not blocks.** The results page (open it on your own screen via "Check-ins" during class; it refreshes live) lists things worth a second look: slow scans, slow logins, the same phone used for two accounts (httpOnly device cookie), a network different from most of the room, and dropped connections.
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

The database lives in the `data` volume. Back it up with `sqlite3 /data/qriz.db ".backup ..."` or by copying the volume while the app is stopped.

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
