# Postify Bot

A Telegram channel management & scheduling bot (Controller Bot alternative) built with TypeScript, grammy, MongoDB & Agenda.

## Features (Roadmap)

| Area                                  | Status                  |
| ------------------------------------- | ----------------------- |
| Channel connection (public & private) | Implemented (basic)     |
| Permission checks (admin rights)      | Basic (post rights)     |
| Multiple channels per user            | Implemented             |
| Draft creation (text, media, buttons) | Implemented             |
| Scheduling (presets + custom)         | Implemented (enhanced)  |
| Timezone preferences                  | Implemented (per-user)  |
| Queues & auto-publish                 | Basic list              |
| Auto delete                           | Implemented (job)       |
| Inline buttons (no counters)          | Implemented             |
| Role-based multi-admin                | Basic (list/add/remove) |
| Group Topic Support                   | Planned                 |
| Link bot (like controllerbot)         | Experimental (per-user) |

## Personal Bot Architecture (Security Hardening)

Each user supplies their own BotFather token. Postify's main bot is now a management & analytics layer only; all channel posting occurs through a per‑user personal bot instance.

Flow:

1. In the main bot: `/addbot` and send your token.
2. Add your personal bot as admin to desired channels.
3. Open the personal bot chat and run `/addchannel` to securely link each channel (stores `botId`).
4. Draft & schedule via either main bot (management) or personal bot; publish step uses personal bot token.

Legacy channels without `botId` will not publish; list them with `/migratechannels` and re-link via personal bot.

Encryption: Provide `ENCRYPTION_KEY` (32‑byte hex or base64). Tokens are stored with AES‑256‑GCM in `tokenEncrypted`. Run migration script once after upgrading:

Run the migration (uses `tsx`):

```
npm run migrate:encrypt-tokens
# or
pnpm migrate:encrypt-tokens
```

If `ENCRYPTION_KEY` is absent, an ephemeral key is used (NOT for production) and tokens become unreadable after restart.

## Development

Create a `.env` file:

```
BOT_TOKEN=123456:ABC...
MONGODB_URI=mongodb://localhost:27017/postify
DB_NAME=postify
LOG_LEVEL=debug
```

Install deps and run in dev mode:

```
npm install
npm run dev
```

### Docker

Build & run the production image (Fastify HTTP server exposes `/docs` for status & info):

```
docker build -t postify .
docker run --env-file .env -p 3000:3000 postify
curl "http://localhost:3000/docs?format=json"
```

### docker-compose (local + MongoDB)

```
cp .env.example .env   # edit BOT_TOKEN
docker compose up --build
```

Services:

- App: http://localhost:3000 (`/docs`)
- MongoDB: localhost:27017

### Docs Endpoint (with Health)

The minimal HTTP layer (Fastify) is required for container platforms. One combined endpoint:

- `GET /docs` / `/` – HTML overview + health/status
- `GET /docs?format=json` – machine-readable health/status JSON (db state, agenda, counts, uptime)

### Render Deployment

1. Create new Web Service from this repo.
2. Environment: Docker.
3. Expose port: 3000 (Render auto-detects via `PORT` env var, already honored).
4. Health Check Path: `/docs?format=json` (optional but recommended).
5. Env Vars (add in dashboard):

- `BOT_TOKEN`
- `MONGODB_URI` (e.g. external MongoDB Atlas or Render addon)
- `DB_NAME` (optional, default `postify`)
- `LOG_LEVEL` (optional)

6. No custom start command needed (`CMD ["node", "dist/index.js"]`).

Render automatically sets `PORT`; the server listens on `0.0.0.0:$PORT`.

### GitHub Container Registry (optional)

A workflow (see `.github/workflows/docker-image.yml`) can build & push an image on pushes to `main` / tags. To enable pushes:

- Add a repository secret `CR_PAT` with a Personal Access Token (packages:write, repo scopes) or use `GITHUB_TOKEN` (already configured in workflow for GHCR).
- Pull image: `docker pull ghcr.io/<owner>/<repo>:latest`.

### Tests

Run unit tests:

```
npm test
```

## Text Formatting

Postify supports rich text formatting using HTML tags:

- `<b>bold text</b>` for **bold**
- `<i>italic text</i>` for _italic_
- `<code>inline code</code>` for `monospace`
- `<pre>code block</pre>` for code blocks
- `<blockquote>quoted text</blockquote>` for quotes

Example:

```
<b>Hello</b> <i>world</i>! Here's some <code>code</code>:

<pre>
function hello() {
  console.log("Hello world!");
}
</pre>

<blockquote>This is a quote</blockquote>
```

## Structure

```
src/
  commands/        # command handlers
  telegram/        # bot instance
  models/          # mongoose models
  services/        # db, scheduling, publishing
  server.ts        # fastify health/docs endpoints
  schedulers/      # (future) recurring logic registration
  analytics/       # analytics calculation & export
  middleware/      # auth, sessions, role checks
  utils/           # helpers & logger
```

## License

MIT

## Scheduling & Draft Workflow (New)

Postify now provides an interactive, low-noise draft + scheduling UI that edits a single control message instead of spamming the chat.

### Drafting

1. Run `/newpost` and pick a channel (or it auto-selects if only one).
2. Send text (HTML formatting supported) and/or attach media (photo/video).
3. Use inline buttons on the draft control message to switch type, add / manage buttons, preview, or clear.

### Scheduling Submenu

Press `⏰ Schedule` to open the scheduling submenu (it reuses one message):

Presets:

- 15m / 30m / 1h / 2h / 4h / 6h
- Tomorrow 09:00 / Tomorrow 18:00
- Next Mon 09:00 / Weekend 10:00

Actions:

- `🕐 Custom` – enter relative (`in 45m`), absolute (`2025-12-25 14:30`), or natural (`next monday 10:00`).
- `🌐 TZ: <YourTZ>` – open timezone picker (paged common IANA zones). Your choice is stored.
- `❌ Cancel` – return to draft controls without scheduling.

### Timezones & Preferences

User preferences are persisted in the database (`preferences.timezone`, `lastSchedulePreset`, `lastCustomScheduleInput`). If no timezone is set, UTC is used. All parsed times respect the stored timezone.

### Clean Chat UX

- The bot edits existing messages for draft updates, scheduling menus, and timezone selection.
- New messages are only sent for final confirmations (success / error) or when media type changes make edits impossible.
- Custom time inputs no longer overwrite draft text; they are parsed separately and either schedule the post or return a validation error.

### Custom Time Examples

```
in 15m
in 2h
tomorrow 09:00
next monday 10:30
2025-12-25 14:30
14:30            # today or tomorrow if past
```

Validation rules:

- Minimum: 1 minute in the future
- Maximum: 6 months ahead
- Conflict warnings if posts are too close or hourly limit reached

### Queue Improvements

`/queue` and the inline “View Queue” button show scheduled posts (and recent drafts in some views) with relative + absolute times in UTC plus your timezone context.

## Roadmap (Upcoming Ideas)

- Per-channel posting constraints visualization
- Rich button analytics & click tracking
- Extended timezone search (free text)
- Recurring / template schedules (cron UI)
- Button counters / A/B tests
