import { Bot } from 'grammy';
import { BotContext } from '../telegram/bot.js';
import { logger } from '../utils/logger.js';

export function registerCoreCommands(bot: Bot<BotContext>) {
  bot.command('start', async (ctx) => {
    await ctx.reply('Welcome to Postify Bot! Use /addchannel to connect a channel.');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply('/addchannel - connect a channel\n/newpost - create a draft\n/schedule - schedule last draft\n/queue - list scheduled posts\n/stats - get stats\n/admins - manage channel admins');
  });

  bot.command('addchannel', async (ctx) => {
    await ctx.reply('Forward a message from the target channel (or add me as admin and send its @username). (Flow not fully implemented)');
  });

  bot.api.setMyCommands([
    { command: 'addchannel', description: 'Connect a channel' },
    { command: 'newpost', description: 'Create a draft' },
    { command: 'schedule', description: 'Schedule last draft' },
    { command: 'queue', description: 'List scheduled posts' },
    { command: 'stats', description: 'Get statistics' },
    { command: 'admins', description: 'Manage channel admins' }
  ]).catch(err => logger.error({ err }, 'setMyCommands failed'));
}
