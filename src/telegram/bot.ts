import { Bot, session, Context, SessionFlavor } from "grammy";
import { env } from "../config/env";
import { registerCoreCommands } from "../commands/core";
import { registerPostCommands } from "../commands/posts";
import { registerAdminCommands } from "../commands/admins";
import {
  registerChannelsCommands,
  handleChannelCallback,
} from "../commands/channels";

// Import all middleware
import { userMiddleware } from "../middleware/user";
import { errorHandlerMiddleware } from "../middleware/errorHandler";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { concurrencyMiddleware } from "../middleware/concurrency";
import { validationMiddleware } from "../middleware/validation";
import { loggingMiddleware } from "../middleware/logging";
import { sessionCleanupMiddleware } from "../middleware/sessionCleanup";

import { PostModel } from "../models/Post";
import { logger } from "../utils/logger";

export interface SessionData {
  draft?: {
    postType?: "text" | "photo" | "video";
    text?: string;
    mediaFileId?: string;
    buttons?: {
      text: string;
      url?: string;
      callbackData?: string;
      counterKey?: string;
    }[];
  };
  awaitingChannelRef?: boolean;
  selectedChannelChatId?: number; // user-selected active channel
  draftPreviewMessageId?: number; // message id of interactive draft preview
  lastDraftTextMessageId?: number; // (legacy single id - kept for backward compatibility)
  draftSourceMessages?: { id: number; html: string }[]; // list of user message ids & formatted html composing draft
  initialDraftMessageId?: number; // id of first user text message starting the draft
  draftEditMode?:
    | "text"
    | "button"
    | "schedule_time"
    | "cron"
    | null;
}

function initial(): SessionData {
  return {};
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<BotContext>(env.BOT_TOKEN);

// Apply middleware in correct order
bot.use(loggingMiddleware);        // Log all requests
bot.use(errorHandlerMiddleware);   // Catch and handle all errors
bot.use(validationMiddleware);     // Validate input
bot.use(rateLimitMiddleware);      // Rate limiting
bot.use(concurrencyMiddleware);    // Concurrency control
bot.use(session({ initial }));    // Session management
bot.use(userMiddleware);           // User management
bot.use(sessionCleanupMiddleware); // Session cleanup

registerCoreCommands(bot);
registerPostCommands(bot);
registerAdminCommands(bot);
registerChannelsCommands(bot);

// Callback dispatcher (channel UI & generic buttons disabled counters)
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  // Channel callbacks
  if (await handleChannelCallback(ctx)) return;
});

// Enhanced error handling
bot.catch((err) => {
  const { ctx, error } = err;
  
  logger.error({
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    userId: ctx?.from?.id,
    chatId: ctx?.chat?.id,
    updateType: ctx?.update.message ? 'message' : 
                ctx?.update.callback_query ? 'callback_query' : 'unknown'
  }, "Unhandled bot error");
  
  // Try to inform user about the error
  if (ctx) {
    try {
      if (ctx.callbackQuery) {
        ctx.answerCallbackQuery({ 
          text: "❌ An unexpected error occurred. Please try again.", 
          show_alert: true 
        }).catch(() => {}); // Silent fail
      } else {
        ctx.reply("❌ An unexpected error occurred. Please try again later.")
          .catch(() => {}); // Silent fail
      }
    } catch {
      // Silent fail for error messages
    }
  }
});

export function launchBot() {
  bot.start();
  logger.info("Bot started");
}
