import { Bot } from "grammy";
import { BotContext } from "../telegram/bot";
import { UserBotModel } from "../models/UserBot";
import { env } from "../config/env";
import { logger } from "../utils/logger";

// Middleware to check if user is the bot owner
function isOwner(ctx: BotContext): boolean {
  if (!env.OWNER_ID) {
    logger.warn("OWNER_ID not configured in environment");
    return false;
  }
  return ctx.from?.id === env.OWNER_ID;
}

export function registerOwnerCommands(bot: Bot<BotContext>) {
  // Reset user bots from error status back to active
  bot.command("reset", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      // Show current status before reset
      const beforeStats = {
        active: await UserBotModel.countDocuments({ status: "active" }),
        error: await UserBotModel.countDocuments({ status: "error" }),
        disabled: await UserBotModel.countDocuments({ status: "disabled" }),
      };

      // Reset all error bots back to active
      const result = await UserBotModel.updateMany(
        { status: "error" },
        { 
          $set: { 
            status: "active",
            lastError: null
          }
        }
      );

      // Show current status after reset
      const afterStats = {
        active: await UserBotModel.countDocuments({ status: "active" }),
        error: await UserBotModel.countDocuments({ status: "error" }),
        disabled: await UserBotModel.countDocuments({ status: "disabled" }),
      };

      const message = [
        "**User Bot Reset Complete**",
        "",
        "**Before:**",
        `Active: ${beforeStats.active}`,
        `Error: ${beforeStats.error}`,
        `Disabled: ${beforeStats.disabled}`,
        "",
        "**After:**",
        `Active: ${afterStats.active}`,
        `Error: ${afterStats.error}`,
        `Disabled: ${afterStats.disabled}`,
        "",
        `Reset ${result.modifiedCount} bots from error to active status`
      ].join("\n");

      await ctx.reply(message, { parse_mode: "Markdown" });

      logger.info({ 
        modifiedCount: result.modifiedCount,
        beforeStats,
        afterStats,
        userId: ctx.from?.id 
      }, "Owner reset user bots");

    } catch (error) {
      logger.error({ error, userId: ctx.from?.id }, "Error in reset_userbots command");
      await ctx.reply("Error resetting user bots. Check logs for details.");
    }
  });

  // Show user bot status overview
  bot.command("bot_status", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      const stats = {
        active: await UserBotModel.countDocuments({ status: "active" }),
        error: await UserBotModel.countDocuments({ status: "error" }),
        disabled: await UserBotModel.countDocuments({ status: "disabled" }),
        total: await UserBotModel.countDocuments({})
      };

      // Get some example error bots
      const errorBots = await UserBotModel.find(
        { status: "error" },
        { botId: 1, lastError: 1 }
      ).limit(3);

      const message = [
        "**Personal Bot Status Overview**",
        "",
        `**Total Bots:** ${stats.total}`,
        `**Active:** ${stats.active}`,
        `**Error:** ${stats.error}`,
        `**Disabled:** ${stats.disabled}`,
        "",
      ];

      if (errorBots.length > 0) {
        message.push("**Recent Errors:**");
        errorBots.forEach(bot => {
          const error = bot.lastError || "Unknown error";
          message.push(`Bot ${bot.botId}: ${error.substring(0, 50)}${error.length > 50 ? '...' : ''}`);
        });
        message.push("");
      }

      if (stats.error > 0) {
        message.push("Use /reset_userbots to reset error bots to active status");
      }

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });

    } catch (error) {
      logger.error({ error, userId: ctx.from?.id }, "Error in bot_status command");
      await ctx.reply("Error getting bot status. Check logs for details.");
    }
  });
}
