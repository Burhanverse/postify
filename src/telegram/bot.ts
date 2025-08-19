import { Bot, session, Context, SessionFlavor } from "grammy";
import { env } from "../config/env";
import { registerCoreCommands } from "../commands/core";
import { registerPostCommands } from "../commands/posts";
import { registerStatsCommands } from "../commands/stats";
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
    postType?: "text" | "photo" | "video" | "poll";
    text?: string;
    mediaFileId?: string;
    buttons?: {
      text: string;
      url?: string;
      callbackData?: string;
      counterKey?: string;
    }[];
    poll?: {
      question: string;
      options: string[];
      isQuiz?: boolean;
      correctOptionId?: number;
    };
  };
  awaitingChannelRef?: boolean;
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
registerStatsCommands(bot);
registerAdminCommands(bot);
registerChannelsCommands(bot);

// Button click handler & counters
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data?.startsWith("btn:")) {
    const [, postId, key] = data.split(":");
    await PostModel.updateOne(
      { _id: postId },
      { $inc: { [`buttonClicks.${key}`]: 1 } },
    );
    try {
      await ctx.answerCallbackQuery({ text: "Recorded ✅", show_alert: false });
    } catch {}
    return;
  }
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
