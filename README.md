# Postify Bot

A Telegram channel management & scheduling bot (Controller Bot alternative) built with TypeScript, grammy, MongoDB & Agenda.

## Features (Roadmap)

| Area                                  | Status                       |
| ------------------------------------- | ---------------------------- |
| Channel connection (public & private) | Implemented (basic)          |
| Permission checks (admin rights)      | Basic (post rights)          |
| Multiple channels per admin           | Implemented                  |
| Draft creation (text, media, buttons) | Implemented                  |
| Post editing & deletion               | Pending                      |
| Crossposting / forwarding             | Pending                      |
| Scheduling & recurring (cron)         | Basic (one-off, cron helper) |
| Queues & auto-publish                 | Basic list                   |
| Auto delete                           | Implemented (job)            |
| Inline buttons (no counters)          | Implemented                  |
| Polls/quizzes                         | Removed (out of scope)       |
| Analytics (views, clicks)             | Removed (out of scope)       |
| CSV/JSON export                       | Removed (analytics removed)  |
| Role-based multi-admin                | Basic (list/add/remove)      |

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

### Docker (optional)

```
docker build -t postify .
docker run --env-file .env postify
```

### Render / VPS

Provide env vars BOT_TOKEN, MONGODB_URI. Run build then start.

### Tests

Run unit tests:

```
npm test
```

## Text Formatting

Postify supports rich text formatting using HTML tags:

- `<b>bold text</b>` for **bold**
- `<i>italic text</i>` for *italic*  
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
  schedulers/      # (future) recurring logic registration
  analytics/       # analytics calculation & export
  middleware/      # auth, sessions, role checks
  utils/           # helpers & logger
```

## License

MIT
