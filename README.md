# Postify Bot

A Telegram channel management & scheduling bot (Controller Bot alternative) built with TypeScript, grammy, MongoDB & Agenda.

## Features (Roadmap)
| Area | Status |
|------|--------|
| Channel connection (public & private) | Planned |
| Permission checks (admin rights) | Planned |
| Multiple channels per admin | Planned |
| Draft creation (text, media, polls, buttons) | Partial (text) |
| Post editing & deletion | Planned |
| Crossposting / forwarding | Planned |
| Scheduling & recurring (cron) | Scaffolded (Agenda) |
| Queues & auto-publish | Planned |
| Auto delete | Scaffolded job |
| Inline buttons with counters | Planned |
| Polls/quizzes | Planned |
| Analytics (views, clicks) | Partial (models) |
| CSV/JSON export | CSV helper stub |
| Role-based multi-admin | Planned |

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
