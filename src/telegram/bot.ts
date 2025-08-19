import { Bot, session, Context, SessionFlavor } from 'grammy';
import { env } from '../config/env.js';
import { registerCoreCommands } from '../commands/core.js';
import { registerPostCommands } from '../commands/posts.js';
import { registerStatsCommands } from '../commands/stats.js';
import { registerAdminCommands } from '../commands/admins.js';
import { userMiddleware } from '../middleware/user.js';
import { InlineKeyboard } from 'grammy';
import { PostModel } from '../models/Post.js';
import { logger } from '../utils/logger.js';

export interface SessionData {
  draft?: {
    postType?: 'text' | 'photo' | 'video' | 'poll';
    text?: string;
    mediaFileId?: string;
    buttons?: { text: string; url?: string; callbackData?: string; counterKey?: string }[];
    poll?: { question: string; options: string[]; isQuiz?: boolean; correctOptionId?: number };
  };
}

function initial(): SessionData { return {}; }

export type BotContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<BotContext>(env.BOT_TOKEN);

bot.use(session({ initial }));
bot.use(userMiddleware);

registerCoreCommands(bot);
registerPostCommands(bot);
registerStatsCommands(bot);
registerAdminCommands(bot);

// Button click handler & counters
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data?.startsWith('btn:')) {
    const [, postId, key] = data.split(':');
    await PostModel.updateOne({ _id: postId }, { $inc: { [`buttonClicks.${key}`]: 1 } });
    try { await ctx.answerCallbackQuery({ text: 'Recorded ✅', show_alert: false }); } catch {}
  }
});

bot.catch(err => {
  logger.error({ err }, 'Bot error');
});

export function launchBot() {
  bot.start();
  logger.info('Bot started');
}
