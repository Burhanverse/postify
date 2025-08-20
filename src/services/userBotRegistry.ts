import { Bot, session } from "grammy";
import { logger } from "../utils/logger";
import { UserBotModel } from "../models/UserBot";
import type { BotContext, SessionData } from "../telegram/bot";
import { loggingMiddleware } from "../middleware/logging";
import { errorHandlerMiddleware } from "../middleware/errorHandler";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { concurrencyMiddleware } from "../middleware/concurrency";
import { validationMiddleware } from "../middleware/validation";
import { userMiddleware } from "../middleware/user";
import { sessionCleanupMiddleware } from "../middleware/sessionCleanup";
import { registerPostCommands } from "../commands/posts";
import { registerChannelsCommands } from "../commands/channels";
import { decrypt } from "../utils/crypto";

const activeBots = new Map<number, Bot<BotContext>>();

function initial(): SessionData { return {}; }

export async function getOrCreateUserBot(botId: number) {
  if (activeBots.has(botId)) return activeBots.get(botId)!;
  const record = await UserBotModel.findOne({ botId, status: "active" });
  if (!record) throw new Error("User bot not found or inactive");
  const rawToken = record.tokenEncrypted
    ? decrypt(record.tokenEncrypted)
    : record.token; // legacy fallback
  if (!rawToken) throw new Error("Bot token missing (migration required)");
  const bot = new Bot<BotContext>(rawToken);
  bot.use(loggingMiddleware);
  bot.use(errorHandlerMiddleware);
  bot.use(session({ initial }));
  bot.use(validationMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(concurrencyMiddleware);
  bot.use(userMiddleware);
  bot.use(sessionCleanupMiddleware);

  registerPostCommands(bot);
  registerChannelsCommands(bot, { enableLinking: true });

  bot.catch((err) => {
    logger.error({ err, botId }, "Unhandled personal bot error");
  });

  bot.start({ drop_pending_updates: false })
    .then(() => logger.info({ botId, username: record.username }, "Personal bot started"))
    .catch((err) => logger.error({ err, botId }, "Failed to start personal bot"));

  activeBots.set(botId, bot);
  return bot;
}

export function stopUserBot(botId: number) {
  const b = activeBots.get(botId);
  if (b) {
    try { b.stop(); } catch (e) { logger.warn({ e, botId }, "Error stopping personal bot"); }
    activeBots.delete(botId);
  }
}

export function listActiveUserBots() { return [...activeBots.keys()]; }
