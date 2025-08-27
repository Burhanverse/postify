# Postify Bot

A Telegram channel management & scheduling bot built with TypeScript, grammy, MongoDB & Agenda.

## Features (Roadmap)

| Area                                  | Status                  |
| ------------------------------------- | ----------------------- |
| Channel connection (public & private) | Implemented             |
| Permission checks (admin rights)      | Basic (post rights)     |
| Multiple channels per user            | Implemented             |
| Draft creation (text, media, buttons) | Implemented             |
| Inline buttons (no counters)          | Implemented             |
| Scheduling (presets + custom)         | Implemented             |
| Timezone preferences                  | Implemented             |
| Queues (scheduled list)               | Testing                 |
| Send/Schedule & Pin the post          | Planned                 |
| Group Topic Support                   | Planned                 |
| Link personal bot                     | Implemented             |

## Roadmap (Upcoming Ideas)

- Add support for pinning the content after being posted.
- Improve text formating of the response messages.

## Development

Create a `.env` file:

```
BOT_TOKEN=123456:ABC...
MONGODB_URI=mongodb://localhost:27017/postify
DB_NAME=postify
ENCRYPTION_KEY=
LOG_LEVEL=debug
```

Encryption: Provide `ENCRYPTION_KEY` (32‑byte hex or base64). Tokens are stored with AES‑256‑GCM in `tokenEncrypted`.

If `ENCRYPTION_KEY` is absent, an ephemeral key is used (NOT for production) and tokens become unreadable after restart.
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

## License

MIT
