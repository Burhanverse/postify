import { Bot, session, Context, SessionFlavor } from "grammy";
import { env } from "../config/env";
import { registerCoreCommands } from "../commands/core";
import { registerPostCommands } from "../commands/posts";
import { registerAdminCommands } from "../commands/admins";
import {
  registerChannelsCommands,
  handleChannelCallback,
} from "../commands/channels";
import { userMiddleware } from "../middleware/user";
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
  draftEditMode?:
    | "text"
    | "button"
    | "schedule_time"
    | "cron"
    | "auto_delete"
    | null;
}

function initial(): SessionData {
  return {};
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<BotContext>(env.BOT_TOKEN);

bot.use(session({ initial }));
bot.use(userMiddleware);

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

bot.catch((err) => {
  logger.error({ err }, "Bot error");
});

export function launchBot() {
  bot.start();
  logger.info("Bot started");
}
