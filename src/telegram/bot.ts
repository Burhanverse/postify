import { Bot, session, Context, SessionFlavor } from "grammy";
import { env } from "../config/env";
import { registerCoreCommands } from "../commands/core";
import { registerPostCommands } from "../commands/posts";
import { registerAdminCommands } from "../commands/admins";
import { registerOwnerCommands } from "../commands/owner";
import { userMiddleware } from "../middleware/user";
import { errorHandlerMiddleware } from "../middleware/errorHandler";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { concurrencyMiddleware } from "../middleware/concurrency";
import { validationMiddleware } from "../middleware/validation";
import { loggingMiddleware } from "../middleware/logging";
import { sessionCleanupMiddleware } from "../middleware/sessionCleanup";
import { messageCleanupMiddleware } from "../middleware/messageCleanup";
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
  selectedChannelChatId?: number;
  draftPreviewMessageId?: number;
  lastDraftTextMessageId?: number;
  draftSourceMessages?: { id: number; html: string }[];
  initialDraftMessageId?: number;
  draftEditMode?: "text" | "button" | "cron" | null;
  waitingForScheduleInput?: boolean;
  controlMessageId?: number;
  scheduleMessageId?: number;
  awaitingBotToken?: boolean;
  awaitingUnlinkBotConfirm?: boolean;
  draftLocked?: boolean;
  scheduleWithPin?: boolean;
  // Message cleanup tracking
  recentBotMessages?: number[]; // Array of message IDs to track for cleanup
  protectedMessages?: {
    scheduleMessages?: number[];
    postSentNotices?: number[];
    currentDraftPreview?: number;
  };
}

function initial(): SessionData {
  return {};
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<BotContext>(env.BOT_TOKEN);

// Apply middleware in correct order
bot.use(loggingMiddleware);
bot.use(errorHandlerMiddleware);
bot.use(session({ initial }));
bot.use(messageCleanupMiddleware); // Add message cleanup after session
bot.use(validationMiddleware);
bot.use(rateLimitMiddleware);
bot.use(concurrencyMiddleware);
bot.use(userMiddleware);
bot.use(sessionCleanupMiddleware);

registerCoreCommands(bot);
registerPostCommands(bot);
registerAdminCommands(bot);
registerOwnerCommands(bot);

// Enhanced error handling
bot.catch((err) => {
  const { ctx, error } = err;

  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userId: ctx?.from?.id,
      chatId: ctx?.chat?.id,
      updateType: ctx?.update.message
        ? "message"
        : ctx?.update.callback_query
          ? "callback_query"
          : "unknown",
    },
    "Unhandled bot error",
  );

  // Try to inform user about the error
  if (ctx) {
    try {
      if (ctx.callbackQuery) {
        ctx
          .answerCallbackQuery({
            text: "An unexpected error occurred. Please try again.",
            show_alert: true,
          })
          .catch(() => {});
      } else {
        ctx
          .reply("An unexpected error occurred. Please try again later.")
          .catch(() => {});
      }
    } catch {}
  }
});

export function launchBot() {
  bot.start({
    drop_pending_updates: true,
  });
  logger.info("Bot started");
}

export async function stopBot() {
  try {
    await bot.stop();
    logger.info("Main bot stopped");
  } catch (error) {
    logger.warn({ error }, "Error stopping main bot");
  }
}
