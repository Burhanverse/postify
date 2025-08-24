import { Bot } from "grammy";
import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";
import { ChannelModel } from "../models/Channel";
import { UserBotModel } from "../models/UserBot";
import { getOrCreateUserBot } from "../services/userBotRegistry";
import { encrypt } from "../utils/crypto";
import { validateBotTokenFormat } from "../utils/tokens";

export function registerCoreCommands(bot: Bot<BotContext>) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to Postify Bot! Use /addbot to register your personal bot, then add it as admin to your channels.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "**COMMANDS**\n" +
        "/addbot - register your personal bot token\n" +
        "/mybot - view your personal bot status\n" +
        "/channels - list your channels (read-only here)\n" +
        "/checkchannels - verify personal bot posting permissions\n" +
        "(Channel linking & posting happens via your personal bot instance)\n",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("addchannel", async (ctx) => {
    await ctx.reply(
      "Channel linking moved to your personal bot. Use /addbot first, then open your personal bot and run /addchannel there.",
    );
  });

  bot.command("addbot", async (ctx) => {
    ctx.session.awaitingBotToken = true;
    await ctx.reply(
      "Send your bot token (from BotFather). It should look like: 123456789:AA... (never share it with anyone else).",
    );
  });

  bot.command("mybot", async (ctx) => {
    const ub = await UserBotModel.findOne({ ownerTgId: ctx.from?.id });
    if (!ub) {
      await ctx.reply("No personal bot configured. Use /addbot to add one.");
      return;
    }
    await ctx.reply(
      `Personal Bot:\nUsername: @${ub.username}\nBot ID: ${ub.botId}\nStatus: ${ub.status}\nToken last 4: ...${ub.tokenLastFour}`,
    );
  });

  // Provide status + restart attempt
  bot.command("botstatus", async (ctx) => {
    const ub = await UserBotModel.findOne({ ownerTgId: ctx.from?.id });
    if (!ub) return ctx.reply("No personal bot registered.");
    return ctx.reply(
      `Status: ${ub.status}${ub.lastError ? "\nLast error: " + ub.lastError : ""}`,
    );
  });

  // Unlink flow with confirmation
  bot.command("unlinkbot", async (ctx) => {
    const ub = await UserBotModel.findOne({ ownerTgId: ctx.from?.id });
    if (!ub) return ctx.reply("No personal bot to unlink.");
    ctx.session.awaitingUnlinkBotConfirm = true;
    await ctx.reply(
      "Type CONFIRM UNLINK to remove your personal bot (cannot be undone).",
      {},
    );
  });

  bot.on("message", async (ctx, next) => {
    // Unlink confirmation
    if (ctx.session.awaitingUnlinkBotConfirm && ctx.message?.text) {
      const val = ctx.message.text.trim();
      ctx.session.awaitingUnlinkBotConfirm = false;
      if (val !== "CONFIRM UNLINK") {
        await ctx.reply("Canceled.");
        return;
      }
      const ub = await UserBotModel.findOne({ ownerTgId: ctx.from?.id });
      if (!ub) return ctx.reply("Already removed.");
      await UserBotModel.deleteOne({ botId: ub.botId });
      await ctx.reply(
        "Personal bot unlinked. You can /addbot again anytime.",
      );
      return;
    }

    if (ctx.session.awaitingBotToken && ctx.message?.text) {
      const token = ctx.message.text.trim();
      ctx.session.awaitingBotToken = false;
      if (!validateBotTokenFormat(token)) {
        await ctx.reply("Invalid token format. Aborted.");
        return;
      }
      try {
        const tempBot = new Bot(token);
        const me = await tempBot.api.getMe();
        if (!me.is_bot) throw new Error("Not a bot account");
        const existing = await UserBotModel.findOne({ botId: me.id });
        if (existing && existing.ownerTgId !== ctx.from?.id) {
          await ctx.reply("This bot is already registered by another user.");
          return;
        }
        const lastFour = token.slice(-4);
        const encrypted = encrypt(token);
        const record = await UserBotModel.findOneAndUpdate(
          { botId: me.id },
          {
            $set: {
              ownerTgId: ctx.from?.id,
              botId: me.id,
              username: me.username,
              tokenEncrypted: encrypted,
              token: undefined,
              tokenLastFour: lastFour,
              status: "active",
              lastSeenAt: new Date(),
              lastError: null,
            },
          },
          { upsert: true, new: true },
        );
        await ctx.reply(
          `Personal bot registered: @${record.username}.\nAdd this bot to your channels as admin, then open it and use /addchannel there to link channels. Use /mybot to view status.`,
        );
        getOrCreateUserBot(record.botId).catch((err) =>
          logger.error(
            { err, botId: record.botId },
            "Failed to start user bot",
          ),
        );
      } catch (err) {
        logger.warn({ err }, "Failed to validate bot token");
        await ctx.reply(
          "Failed to validate token with Telegram. Make sure it's correct and the bot is not banned.",
        );
      }
      return;
    }
    return next();
  });

  bot.command("checkchannels", async (ctx) => {
    const channels = await ChannelModel.find({ owners: ctx.from?.id });
    if (!channels.length) {
      await ctx.reply("No channels linked. (Link them via your personal bot)");
      return;
    }

    let response = "**Channel Status Check:**\n\n";
    for (const channel of channels) {
      const channelName =
        channel.title || channel.username || channel.chatId.toString();
      if (!channel.botId) {
        response += `**${channelName}**\nStatus: Not migrated (no personal bot)\nID: \`${channel.chatId}\`\n\n`;
        continue;
      }
      try {
        response += `**${channelName}**\nStatus: Pending verification via personal bot\nID: \`${channel.chatId}\`\n\n`;
      } catch (error) {
        response += `**${channelName}**\nStatus: Error\nID: \`${channel.chatId}\`\n\n`;
      }
    }

    response +=
      "*Use your personal bot to /addchannel again if status shows Not migrated*";
    await ctx.reply(response, { parse_mode: "Markdown" });
  });

  bot.command("migratechannels", async (ctx) => {
    const legacy = await ChannelModel.find({
      $or: [{ botId: { $exists: false } }, { botId: null }],
    });
    if (!legacy.length) {
      await ctx.reply(
        "All channels migrated (have botId).\nRelink any problematic ones via personal bot.",
      );
      return;
    }
    const lines = legacy
      .slice(0, 25)
      .map(
        (c) => `• ${c.title || c.username || c.chatId} (chatId=${c.chatId})`,
      );
    await ctx.reply(
      `Legacy channels (need relink via personal bot):\n${lines.join("\n")}`,
    );
  });

  bot.api
    .setMyCommands([
      { command: "addbot", description: "Register personal bot" },
      { command: "mybot", description: "Show personal bot status" },
      { command: "botstatus", description: "Personal bot health" },
      { command: "unlinkbot", description: "Remove personal bot" },
      { command: "channels", description: "List connected channels" },
      { command: "checkchannels", description: "Verify channel permissions" },
      { command: "migratechannels", description: "List legacy channels" },
    ])
    .catch((err) => logger.error({ err }, "setMyCommands failed"));
}
