import { Bot } from 'grammy';
import { BotContext } from '../telegram/bot.js';
import { PostModel } from '../models/Post.js';
import { ChannelModel } from '../models/Channel.js';

export function registerPostCommands(bot: Bot<BotContext>) {
  bot.command('newpost', async (ctx) => {
    ctx.session.draft = { postType: 'text' };
    await ctx.reply('Send the text for the post.');
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.draft && !ctx.session.draft.text) {
      ctx.session.draft.text = ctx.message.text;
      await ctx.reply('Draft saved. Use /schedule to schedule or /publish to post now (not implemented yet).');
      return;
    }
    return next();
  });
}
