import { Bot, session } from "grammy";
import { logger } from "../utils/logger";
import { UserBotModel } from "../models/UserBot";
import { ChannelModel } from "../models/Channel";
import type { BotContext, SessionData } from "../telegram/bot";
import { loggingMiddleware } from "../middleware/logging";
import { errorHandlerMiddleware } from "../middleware/errorHandler";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { concurrencyMiddleware } from "../middleware/concurrency";
import { validationMiddleware } from "../middleware/validation";
import { userMiddleware } from "../middleware/user";
import { sessionCleanupMiddleware } from "../middleware/sessionCleanup";
import { messageCleanupMiddleware } from "../middleware/messageCleanup";
import { registerPostCommands } from "../commands/posts";
import {
  registerChannelsCommands,
  handleChannelCallback,
} from "../commands/channels";
import { addStartCommand } from "../commands/core";
import { decrypt } from "../utils/crypto.js";

interface ActiveBotMeta {
  bot: Bot<BotContext>;
  ownerTgId: number;
  username?: string;
  failures: number;
  startedAt: Date;
  isRunning?: boolean; // Track if bot is actually running
}

const activeBots = new Map<number, ActiveBotMeta>();

// Track bots that are currently being created to avoid races that would
// spawn multiple Bot instances for the same token (causes Telegram 409).
const creatingBots = new Map<number, Promise<Bot<BotContext>>>();

// Track bots that failed during startup to avoid repeated attempts
const failedBots = new Set<number>();

// Track startup completion
let startupComplete = false;

// Ownership guard middleware
function personalBotOwnershipGuard(ownerId: number) {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    if (!ctx.from || ctx.from.id !== ownerId) {
      return;
    }
    return next();
  };
}

function initial(): SessionData {
  return {};
}

export async function getOrCreateUserBot(botId: number) {
  const existing = activeBots.get(botId);
  if (existing && existing.isRunning) {
    // Double-check that the bot is actually running
    if (existing.bot.isRunning()) {
      return existing.bot;
    } else {
      // Bot is marked as running but actually stopped, clean it up
      logger.warn({ botId }, "Found stale bot entry, cleaning up");
      activeBots.delete(botId);
    }
  }

  // If creation is in-flight for the same botId, wait for it instead of
  // creating another Bot instance which would cause a Telegram 409 error.
  const inFlight = creatingBots.get(botId);
  if (inFlight) {
    logger.debug({ botId }, "Bot creation already in progress, waiting for completion");
    return inFlight;
  }

  // Don't try to restart bots that failed recently
  if (failedBots.has(botId)) {
    logger.warn(
      { botId, failedBotsCount: failedBots.size },
      "Bot is in failed list, skipping restart to avoid conflicts",
    );
    throw new Error(
      `Bot ${botId} recently failed, skipping restart to avoid conflicts`,
    );
  }

  // Add extra safety: if there's any existing bot instance for this botId, stop it first
  const existingBot = activeBots.get(botId);
  if (existingBot) {
    logger.warn({ botId }, "Found existing bot instance, stopping before creating new one");
    try {
      existingBot.isRunning = false;
      if (existingBot.bot.isRunning()) {
        await existingBot.bot.stop();
      }
    } catch (e) {
      logger.warn({ e, botId }, "Error stopping existing bot instance");
    }
    activeBots.delete(botId);
    
    // Add a small delay to ensure the previous instance is fully stopped
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const creation = (async () => {
    const record = await UserBotModel.findOne({ botId, status: "active" });
    if (!record) throw new Error("User bot not found or inactive");
    const rawToken = record.tokenEncrypted
      ? decrypt(record.tokenEncrypted)
      : record.token;
    if (!rawToken) throw new Error("Bot token missing or invalid");
    const bot = new Bot<BotContext>(rawToken);

    // Ownership guard FIRST
    bot.use(personalBotOwnershipGuard(record.ownerTgId));
    bot.use(loggingMiddleware);
    bot.use(errorHandlerMiddleware);
    bot.use(session({ initial }));
    bot.use(validationMiddleware);
    bot.use(rateLimitMiddleware);
    bot.use(concurrencyMiddleware);
    bot.use(userMiddleware);
    bot.use(sessionCleanupMiddleware);
    bot.use(messageCleanupMiddleware);

    registerPostCommands(bot);
    registerChannelsCommands(bot, { enableLinking: true });

    // Add enhanced start/about command for personal bots
    addStartCommand(bot, true);

    // Check channels command
    bot.command("checkchannels", async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Authentication required.");
        return;
      }

      const channels = await ChannelModel.find({
        owners: userId,
        botId: record.botId,
      });

      if (!channels.length) {
        await ctx.reply(
          "**No channels linked to this bot**\n\nUse /addchannel to link channels to this personal bot.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      let response = "**Channel Status Check:**\n\n";

      for (const channel of channels) {
        const channelName =
          channel.title || channel.username || channel.chatId.toString();

        try {
          // Test if bot can send to the channel
          const chatMember = await bot.api.getChatMember(
            channel.chatId,
            record.botId,
          );
          const canPost =
            chatMember.status === "administrator" &&
            (chatMember.can_post_messages === true ||
              chatMember.can_post_messages === undefined);

          if (canPost) {
            response += `**${channelName}**\nStatus: Ready (Admin with posting rights)\nID: \`${channel.chatId}\`\n\n`;
          } else {
            response += `**${channelName}**\nStatus: Limited access (Check admin permissions)\nID: \`${channel.chatId}\`\n\n`;
          }
        } catch (error) {
          response += `**${channelName}**\nStatus: Cannot access (Bot may be removed)\nID: \`${channel.chatId}\`\n\n`;
        }
      }

      response += "*Tip: Re-add this bot as admin to channels showing errors*";
      await ctx.reply(response, { parse_mode: "Markdown" });
    });

    bot.on("callback_query:data", async (ctx, next) => {
      if (await handleChannelCallback(ctx)) return; // handled
      return next();
    });

    bot.api
      .setMyCommands([
        { command: "start", description: "Show bot information" },
        { command: "newpost", description: "Create a new post" },
        {
          command: "preview",
          description: "Force regenerate preview of the post",
        },
        { command: "queue", description: "View scheduled posts" },
        { command: "addchannel", description: "Link a channel to this bot" },
        { command: "channels", description: "List linked channels" },
        { command: "checkchannels", description: "Verify channel permissions" },
        { command: "cancel", description: "Cancel current draft" },
        { command: "about", description: "About Postify Bot" },
      ])
      .catch((err) => {
        logger.warn({ err, botId }, "Failed setting personal bot commands");
      });

    bot.catch((err) => {
      const meta = activeBots.get(botId);
      if (meta) {
        meta.failures += 1;

        // Check if this is a 409 conflict error
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes("409") && errorMessage.includes("Conflict")) {
          logger.error(
            { err, botId, failures: meta.failures },
            "Telegram 409 conflict detected - multiple instances running",
          );

          // Mark bot as not running and remove from active bots
          meta.isRunning = false;
          activeBots.delete(botId);
          failedBots.add(botId);

          // Stop the bot instance
          try {
            meta.bot.stop();
          } catch (e) {
            // Ignore stop errors
          }

          // Set a longer timeout for 409 errors (15 minutes)
          setTimeout(
            () => {
              failedBots.delete(botId);
              logger.info(
                { botId },
                "Removed bot from failed list after 409 conflict, allowing retry",
              );
            },
            15 * 60 * 1000,
          );
        }
      }
      logger.error({ err, botId }, "Unhandled personal bot error");
    });

    // Start bot asynchronously and handle registration properly
    bot
      .start({ drop_pending_updates: true })
      .then(() => {
        // Only add to activeBots AFTER successful start
        activeBots.set(botId, {
          bot,
          ownerTgId: record.ownerTgId,
          username: record.username || undefined,
          failures: 0,
          startedAt: new Date(),
          isRunning: true,
        });

        // Remove from failed bots if it was there
        failedBots.delete(botId);

        logger.info(
          { botId, username: record.username, owner: record.ownerTgId },
          "Personal bot started successfully",
        );
      })
      .catch(async (err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const is409Conflict = errorMessage.includes("409") && errorMessage.includes("Conflict");
        const is401Unauthorized = errorMessage.includes("401") && errorMessage.includes("Unauthorized");
        
        logger.error({ err, botId, is409Conflict, is401Unauthorized }, "Failed to start personal bot");

        // Mark as failed to prevent immediate retry
        failedBots.add(botId);

        // Different timeout strategies based on error type
        let timeoutMinutes;
        if (is401Unauthorized) {
          // 401 errors are permanent until token is fixed - longer timeout
          timeoutMinutes = 60; // 1 hour
        } else if (is409Conflict) {
          timeoutMinutes = 15;
        } else {
          timeoutMinutes = 10;
        }
        
        setTimeout(
          () => {
            failedBots.delete(botId);
            logger.debug(
              { botId, was409: is409Conflict, was401: is401Unauthorized },
              "Removed bot from failed list, allowing retry",
            );
          },
          timeoutMinutes * 60 * 1000,
        );

        // Update database status - for 401 errors, set status to disabled
        const newStatus = is401Unauthorized ? "disabled" : "error";
        const errorPrefix = is401Unauthorized ? "Invalid/revoked token: " : "";
        
        await UserBotModel.updateOne(
          { botId },
          { $set: { status: newStatus, lastError: errorPrefix + errorMessage } },
        );

        // Special handling for different error types
        if (is401Unauthorized) {
          logger.warn(
            { botId },
            "Bot token is invalid or revoked - bot disabled until token is updated",
          );
        } else if (is409Conflict) {
          logger.warn(
            { botId },
            "409 conflict detected, performing aggressive cleanup",
          );
          
          // Remove from active bots if somehow still there
          if (activeBots.has(botId)) {
            const existingMeta = activeBots.get(botId);
            if (existingMeta) {
              existingMeta.isRunning = false;
            }
            activeBots.delete(botId);
          }
        }

        // Stop the bot if it was partially started
        try {
          await bot.stop();
        } catch (e) {
          logger.debug({ e, botId }, "Error stopping bot during cleanup (expected)");
        }
      });

    return bot;
  })();

  creatingBots.set(botId, creation);
  try {
    const result = await creation;
    return result;
  } finally {
    creatingBots.delete(botId);
  }
}

export function stopUserBot(botId: number) {
  const meta = activeBots.get(botId);
  if (meta) {
    try {
      // Mark as not running immediately to prevent race conditions
      meta.isRunning = false;
      if (meta.bot.isRunning()) {
        meta.bot.stop();
      }
    } catch (e) {
      logger.warn({ e, botId }, "Error stopping personal bot");
    }
    activeBots.delete(botId);
  }
}

export async function stopAllUserBots() {
  logger.info({ count: activeBots.size }, "Stopping all personal bots");

  const stopPromises = Array.from(activeBots.entries()).map(
    async ([botId, meta]) => {
      try {
        // Mark as not running immediately to prevent race conditions
        meta.isRunning = false;

        // Check if bot is already stopped or stopping
        if (meta.bot.isRunning()) {
          await meta.bot.stop();
          logger.debug(
            { botId, username: meta.username },
            "Personal bot stopped",
          );
        } else {
          logger.debug(
            { botId, username: meta.username },
            "Personal bot was already stopped",
          );
        }
      } catch (e) {
        // Log but don't fail the shutdown process for individual bot failures
        logger.warn(
          { e, botId, username: meta.username },
          "Error stopping personal bot during shutdown",
        );
      }
    },
  ); // Wait for all stop operations to complete (or timeout after 10 seconds)
  await Promise.race([
    Promise.allSettled(stopPromises),
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);

  activeBots.clear();

  // Clear any in-flight bot creation processes
  creatingBots.clear();

  logger.info("All personal bots shutdown process completed");
}

export function listActiveUserBots() {
  return [...activeBots.keys()];
}

export function clearFailedBots() {
  failedBots.clear();
  logger.info("Cleared failed bots list");
}

// Clear specific bot from failed bots list
export function clearFailedBot(botId: number) {
  const wasRemoved = failedBots.delete(botId);
  if (wasRemoved) {
    logger.debug({ botId }, "Removed bot from failed list");
  }
  return wasRemoved;
}

// Clean up any stale bot instances that are marked as running but actually stopped
export function cleanupStaleBots() {
  let cleanedCount = 0;
  for (const [botId, meta] of activeBots.entries()) {
    if (meta.isRunning && !meta.bot.isRunning()) {
      logger.warn(
        { botId },
        "Found stale bot instance, removing from registry",
      );
      activeBots.delete(botId);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    logger.info({ cleanedCount }, "Cleaned up stale bot instances");
  }
  return cleanedCount;
}

// Force stop all instances of a specific bot (for handling persistent conflicts)
export async function forceStopBot(botId: number) {
  logger.info({ botId }, "Force stopping bot - cleaning up all instances");
  
  // Remove from active bots
  const meta = activeBots.get(botId);
  if (meta) {
    try {
      meta.isRunning = false;
      if (meta.bot.isRunning()) {
        await meta.bot.stop();
      }
    } catch (e) {
      logger.debug({ e, botId }, "Error during force stop (expected)");
    }
    activeBots.delete(botId);
  }
  
  // Remove from creating bots
  creatingBots.delete(botId);
  
  // Remove from failed bots to allow immediate restart
  failedBots.delete(botId);
  
  // Wait a moment for cleanup to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  logger.info({ botId }, "Force stop completed");
}

// Get detailed status of all bots
export function getBotStatus() {
  const status = {
    active: activeBots.size,
    creating: creatingBots.size,
    failed: failedBots.size,
    failedBotIds: Array.from(failedBots), // Add this for debugging
    details: Array.from(activeBots.entries()).map(([botId, meta]) => ({
      botId,
      username: meta.username,
      ownerTgId: meta.ownerTgId,
      startedAt: meta.startedAt,
      isRunning: meta.isRunning,
      actuallyRunning: meta.bot.isRunning(),
      failures: meta.failures,
    })),
  };
  return status;
}

export async function loadAllUserBotsOnStartup() {
  try {
    // First, clean up any stale bot instances
    cleanupStaleBots();

    const records = await UserBotModel.find({ status: "active" }).limit(500); // safety cap
    logger.info({ count: records.length }, "Loading personal bots on startup");

    if (records.length === 0) {
      // Check if there are any user bots at all
      const totalCount = await UserBotModel.countDocuments();
      const activeCount = await UserBotModel.countDocuments({
        status: "active",
      });
      const disabledCount = await UserBotModel.countDocuments({
        status: "disabled",
      });
      const errorCount = await UserBotModel.countDocuments({ status: "error" });

      logger.info(
        {
          totalCount,
          activeCount,
          disabledCount,
          errorCount,
        },
        "User bot status breakdown - no active bots found",
      );
      startupComplete = true;
      return;
    }

    // Start bots sequentially instead of in parallel to avoid conflicts
    // Increase delays to ensure no overlap
    for (const [index, rec] of records.entries()) {
      try {
        // Wait 5 seconds between each bot start to ensure no overlap (increased from 3)
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        // Skip if bot is already active
        if (activeBots.has(rec.botId)) {
          logger.debug(
            { botId: rec.botId },
            "Bot already active, skipping startup",
          );
          continue;
        }

        logger.info(
          { botId: rec.botId, owner: rec.ownerTgId },
          "Starting personal bot",
        );
        await getOrCreateUserBot(rec.botId);

        // Wait longer to ensure the bot is fully started before continuing (increased from 1s)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        logger.error(
          { err, botId: rec.botId },
          "Failed to launch personal bot on startup",
        );
      }
    }

    startupComplete = true;
    logger.info("Personal bot startup complete");

    // Log final status
    const status = getBotStatus();
    logger.info(status, "Bot registry status after startup");
  } catch (err) {
    logger.error({ err }, "Error in loadAllUserBotsOnStartup");
    startupComplete = true;
  }
}
