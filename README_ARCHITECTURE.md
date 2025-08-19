# Postify Architecture Overview

## Core Components
- Telegram Interface (grammy bot) in `src/telegram/bot.ts`
- Command handlers in `src/commands/`
- Persistence via MongoDB (Mongoose models in `src/models/`)
- Scheduling via Agenda (`src/services/agenda.ts`)
- Publishing pipeline (`src/services/publisher.ts`)
- Analytics collection (click events, view counters) planned
- Role-based access (middleware placeholder `src/middleware/auth.ts`)

## Data Models (Initial)
- User: Telegram user metadata + list of channels
- Channel: Chat info, admin roles mapping
- Post: Draft/scheduled/published post data, buttons, stats
- ClickEvent: Individual button click (for detailed analytics or aggregation)

## Scheduling
Agenda jobs:
- `publish_post` — publish a scheduled post
- `auto_delete_post` — delete a post after TTL (pending implementation)
Future jobs: recurrence expansion, aggregation, report generation.

## Sessions
In-memory (default). Consider migrating to Redis-backed session for scale (grammy StorageAdapter).

## Scaling Considerations
- Use webhook mode with a load balancer; ensure idempotent processing (dedupe by update_id via storage) when horizontally scaling.
- Isolate scheduler to a single worker (or use distributed locks). Agenda uses Mongo DB-based locking.
- Add indexes (already some). Additional compound indexes for analytics queries.

## Next Implementation Steps
1. Channel linking flow (/addchannel) + permission validation (getChatMember).
2. Enhance draft builder (media upload, polls, inline button builder wizard).
3. Scheduling command (/schedule) storing schedule + agenda job.
4. Queue management (/queue, reorder, cancel).
5. Button callback handlers + counters persistence.
6. Analytics export command.
7. Role management (/admins add/remove, roles).
8. Private channel support via invite link retrieval and storage.

## Error Handling & Logging
Pino logger used; add error boundaries around external API calls (Telegram, Mongo). Central `bot.catch` installed.

## Deployment
Dockerfile provided. Provide env vars. Optionally add health check endpoint (future) for uptime monitoring.
