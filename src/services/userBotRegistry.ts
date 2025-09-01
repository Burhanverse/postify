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
import { registerChannelsCommands, handleChannelCallback } from "../commands/channels";
import { decrypt } from "../utils/crypto.js";

interface ActiveBotMeta {
  bot: Bot<BotContext>;
  ownerTgId: number;
  username?: string;
  failures: number;
  startedAt: Date;
}

const activeBots = new Map<number, ActiveBotMeta>();

// Track bots that are currently being created to avoid races that would
// spawn multiple Bot instances for the same token (causes Telegram 409).
const creatingBots = new Map<number, Promise<Bot<BotContext>>>();

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

    // Check channels command
    bot.command("checkchannels", async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply("Authentication required.");
        return;
      }

      const channels = await ChannelModel.find({ 
        owners: userId,
        botId: record.botId 
      });
      
      if (!channels.length) {
        await ctx.reply(
          "**No channels linked to this bot**\n\nUse /addchannel to link channels to this personal bot.",
          { parse_mode: "Markdown" }
        );
        return;
      }

      let response = "**Channel Status Check:**\n\n";
      
      for (const channel of channels) {
        const channelName = channel.title || channel.username || channel.chatId.toString();
        
        try {
          // Test if bot can send to the channel
          const chatMember = await bot.api.getChatMember(channel.chatId, record.botId);
          const canPost = chatMember.status === "administrator" && 
                         (chatMember.can_post_messages === true || chatMember.can_post_messages === undefined);
          
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
        { command: "newpost", description: "Create a new post" },
        { command: "queue", description: "View scheduled posts" },
        { command: "addchannel", description: "Link a channel to this bot" },
        { command: "channels", description: "List linked channels" },
        { command: "checkchannels", description: "Verify channel permissions" },
        { command: "schedule", description: "(Use buttons)" },
        { command: "cancel", description: "Cancel current draft" },
      ])
      .catch((err) => {
        logger.warn({ err, botId }, "Failed setting personal bot commands");
      });

    bot.catch((err) => {
      const meta = activeBots.get(botId);
      if (meta) meta.failures += 1;
      logger.error({ err, botId }, "Unhandled personal bot error");
    });

    activeBots.set(botId, {
      bot,
      ownerTgId: record.ownerTgId,
      username: record.username || undefined,
      failures: 0,
      startedAt: new Date(),
    });
    bot
      .start({ drop_pending_updates: true })
      .then(() => {
        logger.info(
          { botId, username: record.username, owner: record.ownerTgId },
          "Personal bot started",
        );
      })
      .catch(async (err) => {
        logger.error({ err, botId }, "Failed to start personal bot");
        stopUserBot(botId);
        await UserBotModel.updateOne(
          { botId },
          { $set: { status: "error", lastError: (err as Error).message } },
        );
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

export function listActiveUserBots() {
  return [...activeBots.keys()];
}

export async function loadAllUserBotsOnStartup() {
  const records = await UserBotModel.find({ status: "active" }).limit(500); // safety cap
  logger.info({ count: records.length }, "Loading personal bots on startup");
  for (const rec of records) {
    try {
      await getOrCreateUserBot(rec.botId);
    } catch (err) {
      logger.error(
        { err, botId: rec.botId },
        "Failed to launch personal bot on startup",
      );
    }
  }
}

// Simple supervisor loop: checks for bots marked active but not running, restarts; also demotes bots with many failures.
let supervisorStarted = false;
export function startUserBotSupervisor(intervalMs = 30000) {
  if (supervisorStarted) return;
  supervisorStarted = true;
  setInterval(async () => {
    try {
      const activeRecords = await UserBotModel.find(
        { status: "active" },
        { botId: 1, ownerTgId: 1 },
      );
      const desired = new Set(activeRecords.map((r) => r.botId));
      // Restart missing
      for (const botId of desired) {
        if (!activeBots.has(botId)) {
          logger.warn({ botId }, "Supervisor restarting missing personal bot");
          try {
            await getOrCreateUserBot(botId);
          } catch (e) {
            logger.error({ e, botId }, "Restart failed");
          }
        }
      }
      // Stop stray bots (status changed)
      for (const running of activeBots.keys()) {
        if (!desired.has(running)) {
          logger.info(
            { botId: running },
            "Stopping personal bot no longer active",
          );
          stopUserBot(running);
        }
      }
      // Failure demotion
      for (const [botId, meta] of activeBots) {
        if (meta.failures >= 5) {
          logger.error(
            { botId },
            "Too many failures; marking user bot error and stopping",
          );
          stopUserBot(botId);
          await UserBotModel.updateOne(
            { botId },
            { $set: { status: "error", lastError: "Too many runtime errors" } },
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Supervisor iteration error");
    }
  }, intervalMs).unref();
}
