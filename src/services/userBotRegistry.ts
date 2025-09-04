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
  if (existing) return existing.bot;

  // If creation is in-flight for the same botId, wait for it instead of
  // creating another Bot instance which would cause a Telegram 409 error.
  const inFlight = creatingBots.get(botId);
  if (inFlight) return inFlight;

  // Don't try to restart bots that failed recently
  if (failedBots.has(botId)) {
    throw new Error(
      `Bot ${botId} recently failed, skipping restart to avoid conflicts`,
    );
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
      if (meta) meta.failures += 1;
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
          "Personal bot started",
        );
      })
      .catch(async (err) => {
        logger.error({ err, botId }, "Failed to start personal bot");

        // Mark as failed to prevent immediate retry
        failedBots.add(botId);

        // Set a timer to remove from failed bots after 5 minutes
        setTimeout(
          () => {
            failedBots.delete(botId);
            logger.debug(
              { botId },
              "Removed bot from failed list, allowing retry",
            );
          },
          5 * 60 * 1000,
        );

        await UserBotModel.updateOne(
          { botId },
          { $set: { status: "error", lastError: (err as Error).message } },
        );

        // Stop the bot if it was partially started
        try {
          bot.stop();
        } catch (e) {
          // Ignore stop errors
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
      meta.bot.stop();
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
  );

  // Wait for all stop operations to complete (or timeout after 10 seconds)
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

export async function loadAllUserBotsOnStartup() {
  try {
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
    for (const [index, rec] of records.entries()) {
      try {
        // Wait 3 seconds between each bot start to ensure no overlap
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        logger.info(
          { botId: rec.botId, owner: rec.ownerTgId },
          "Starting personal bot",
        );
        await getOrCreateUserBot(rec.botId);

        // Wait a bit more to ensure the bot is fully started before continuing
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        logger.error(
          { err, botId: rec.botId },
          "Failed to launch personal bot on startup",
        );
      }
    }

    startupComplete = true;
    logger.info("Personal bot startup complete");
  } catch (err) {
    logger.error({ err }, "Error in loadAllUserBotsOnStartup");
    startupComplete = true;
  }
}

// Supervisor removed: Sequential startup prevents race conditions, supervisor was causing 409 conflicts
// Personal bots work reliably once started, no restart logic needed
