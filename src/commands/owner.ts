import { Bot } from "grammy";
import { BotContext } from "../telegram/bot";
import { UserBotModel } from "../models/UserBot";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import {
  getBotStatus,
  cleanupStaleBots,
  clearFailedBots,
  clearFailedBot,
  getOrCreateUserBot,
} from "../services/userBotRegistry";

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

      // Get the bots that were reset before actually resetting them
      const botsToRestart = await UserBotModel.find(
        { status: "error" },
        { botId: 1 }
      );

      // Reset all error bots back to active
      const result = await UserBotModel.updateMany(
        { status: "error" },
        {
          $set: {
            status: "active",
            lastError: null,
          },
        },
      );

      // Show current status after reset
      const afterStats = {
        active: await UserBotModel.countDocuments({ status: "active" }),
        error: await UserBotModel.countDocuments({ status: "error" }),
        disabled: await UserBotModel.countDocuments({ status: "disabled" }),
      };

      let restartResults = { success: 0, failed: 0 };

      // Attempt to restart the bots that were reset
      if (botsToRestart.length > 0) {
        await ctx.reply("Restarting reset bots...", { parse_mode: "Markdown" });
        
        for (const botRecord of botsToRestart) {
          try {
            // Clear this specific bot from failed list first to allow restart
            clearFailedBot(botRecord.botId);
            
            logger.debug(
              { botId: botRecord.botId },
              "Attempting to restart bot after reset"
            );
            await getOrCreateUserBot(botRecord.botId);
            restartResults.success++;
            logger.info(
              { botId: botRecord.botId },
              "Successfully restarted bot after reset"
            );
            // Add a small delay between restarts to avoid conflicts
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            restartResults.failed++;
            logger.error(
              { 
                error: error instanceof Error ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name
                } : error,
                botId: botRecord.botId 
              },
              "Failed to restart bot after reset"
            );
          }
        }
      }

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
        `Reset ${result.modifiedCount} bots from error to active status`,
      ];

      // Add restart results if any bots were restarted
      if (botsToRestart.length > 0) {
        message.push("");
        message.push("**Restart Results:**");
        message.push(`Successfully restarted: ${restartResults.success}`);
        message.push(`Failed to restart: ${restartResults.failed}`);
        if (restartResults.failed > 0) {
          message.push("*Failed bots will retry automatically when used*");
        }
      }

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });

      logger.info(
        {
          modifiedCount: result.modifiedCount,
          beforeStats,
          afterStats,
          restartResults,
          userId: ctx.from?.id,
        },
        "Owner reset user bots",
      );
    } catch (error) {
      logger.error(
        { error, userId: ctx.from?.id },
        "Error in reset_userbots command",
      );
      await ctx.reply("Error resetting user bots. Check logs for details.");
    }
  });

  // Show user bot status overview
  bot.command("userbots", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      const stats = {
        active: await UserBotModel.countDocuments({ status: "active" }),
        error: await UserBotModel.countDocuments({ status: "error" }),
        disabled: await UserBotModel.countDocuments({ status: "disabled" }),
        total: await UserBotModel.countDocuments({}),
      };

      // Get some example error bots
      const errorBots = await UserBotModel.find(
        { status: "error" },
        { botId: 1, lastError: 1 },
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
        errorBots.forEach((bot) => {
          const error = bot.lastError || "Unknown error";
          message.push(
            `Bot ${bot.botId}: ${error.substring(0, 50)}${error.length > 50 ? "..." : ""}`,
          );
        });
        message.push("");
      }

      if (stats.error > 0) {
        message.push(
          "Use /reset_userbots to reset error bots to active status",
        );
      }

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });
    } catch (error) {
      logger.error(
        { error, userId: ctx.from?.id },
        "Error in bot_status command",
      );
      await ctx.reply("Error getting bot status. Check logs for details.");
    }
  });

  // Show detailed bot registry status
  bot.command("botstatus", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      const status = getBotStatus();
      
      const message = [
        "**Bot Registry Status**",
        "",
        `**Active in Registry:** ${status.active}`,
        `**Creating:** ${status.creating}`,
        `**Failed:** ${status.failed}`,
        "",
      ];

      if (status.failed > 0) {
        message.push("**Failed Bot IDs:**");
        message.push(status.failedBotIds.join(", "));
        message.push("");
      }

      if (status.details.length > 0) {
        message.push("**Active Bot Details:**");
        status.details.forEach((bot) => {
          const statusIcon = bot.isRunning && bot.actuallyRunning ? "[OK]" : "[ERR]";
          message.push(
            `${statusIcon} Bot ${bot.botId} (${bot.username || "unknown"})`,
          );
          message.push(`   Owner: ${bot.ownerTgId}`);
          message.push(`   Started: ${bot.startedAt.toISOString()}`);
          message.push(`   Failures: ${bot.failures}`);
          message.push(`   Registry Running: ${bot.isRunning}`);
          message.push(`   Actually Running: ${bot.actuallyRunning}`);
          message.push("");
        });
      }

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });
    } catch (error) {
      logger.error(
        { error, userId: ctx.from?.id },
        "Error in botstatus command",
      );
      await ctx.reply("Error getting detailed bot status. Check logs for details.");
    }
  });

  // Clean up stale bot instances
  bot.command("cleanup", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      const cleanedCount = cleanupStaleBots();
      const statusAfter = getBotStatus();
      
      const message = [
        "**Bot Cleanup Complete**",
        "",
        `**Cleaned up:** ${cleanedCount} stale bot instances`,
        `**Active after cleanup:** ${statusAfter.active}`,
        `**Creating:** ${statusAfter.creating}`,
        `**Failed:** ${statusAfter.failed}`,
      ];

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });
      
      logger.info(
        { cleanedCount, statusAfter, userId: ctx.from?.id },
        "Owner performed bot cleanup",
      );
    } catch (error) {
      logger.error(
        { error, userId: ctx.from?.id },
        "Error in cleanup command",
      );
      await ctx.reply("Error during bot cleanup. Check logs for details.");
    }
  });

  // Clear failed bots list
  bot.command("clearfailed", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      const statusBefore = getBotStatus();
      clearFailedBots();
      const statusAfter = getBotStatus();
      
      const message = [
        "**Failed Bots List Cleared**",
        "",
        `**Failed before:** ${statusBefore.failed}`,
        `**Failed after:** ${statusAfter.failed}`,
        "",
        "Failed bots can now be restarted immediately.",
      ];

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });
      
      logger.info(
        { statusBefore: statusBefore.failed, userId: ctx.from?.id },
        "Owner cleared failed bots list",
      );
    } catch (error) {
      logger.error(
        { error, userId: ctx.from?.id },
        "Error in clearfailed command",
      );
      await ctx.reply("Error clearing failed bots list. Check logs for details.");
    }
  });

  // Restart all active bots that are not currently running
  bot.command("restartbots", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is only available to the bot owner.");
      return;
    }

    try {
      // Get all active bots from database
      const activeBots = await UserBotModel.find({ status: "active" });
      const registryStatus = getBotStatus();
      const currentlyRunning = new Set(registryStatus.details.map(bot => bot.botId));
      
      // Find bots that should be running but aren't
      const botsToRestart = activeBots.filter(bot => !currentlyRunning.has(bot.botId));
      
      if (botsToRestart.length === 0) {
        await ctx.reply("All active bots are already running in the registry.");
        return;
      }

      await ctx.reply(
        `Found ${botsToRestart.length} active bots not running. Starting restart process...`,
        { parse_mode: "Markdown" }
      );

      let restartResults = { success: 0, failed: 0 };

      for (const botRecord of botsToRestart) {
        try {
          // Clear this bot from failed list first to allow restart
          clearFailedBot(botRecord.botId);
          
          await getOrCreateUserBot(botRecord.botId);
          restartResults.success++;
          logger.info(
            { botId: botRecord.botId, username: botRecord.username },
            "Successfully restarted bot via restartbots command"
          );
          // Add delay between restarts to avoid conflicts
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          restartResults.failed++;
          logger.error(
            { error, botId: botRecord.botId, username: botRecord.username },
            "Failed to restart bot via restartbots command"
          );
        }
      }

      const finalStatus = getBotStatus();
      
      const message = [
        "**Bot Restart Complete**",
        "",
        `**Attempted to restart:** ${botsToRestart.length} bots`,
        `**Successfully restarted:** ${restartResults.success}`,
        `**Failed to restart:** ${restartResults.failed}`,
        "",
        `**Currently running:** ${finalStatus.active} bots`,
        `**Creating:** ${finalStatus.creating}`,
        `**Failed:** ${finalStatus.failed}`,
      ];

      if (restartResults.failed > 0) {
        message.push("");
        message.push("*Failed bots will retry automatically when used*");
      }

      await ctx.reply(message.join("\n"), { parse_mode: "Markdown" });
      
      logger.info(
        { 
          attempted: botsToRestart.length,
          restartResults,
          finalStatus,
          userId: ctx.from?.id 
        },
        "Owner performed bot restart command",
      );
    } catch (error) {
      logger.error(
        { error, userId: ctx.from?.id },
        "Error in restartbots command",
      );
      await ctx.reply("Error during bot restart. Check logs for details.");
    }
  });
}
