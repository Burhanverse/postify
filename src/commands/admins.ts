import { Bot } from "grammy";
import { BotContext } from "../telegram/bot.js";
import { ChannelModel } from "../models/Channel.js";

export function registerAdminCommands(bot: Bot<BotContext>) {
  bot.command("admins", async (ctx) => {
    await ctx.reply("Admins management not implemented yet.");
  });
}
