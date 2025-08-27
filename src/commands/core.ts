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
        "(Channel management happens via your personal bot instance)\n",
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
      let msg = `Personal Bot:\nUsername: @${ub.username}\nBot ID: ${ub.botId}\nStatus: ${ub.status}\nToken last 4: ...${ub.tokenLastFour}`;
      if (ub.lastError) {
        msg += `\nLast error: ${ub.lastError}`;
      }
      await ctx.reply(msg);
  });

  // Unlink flow with confirmation
    bot.command("unlinkbot", async (ctx) => {
      const ub = await UserBotModel.findOne({ ownerTgId: ctx.from?.id });
      if (!ub) return ctx.reply("No personal bot to unlink.");
      ctx.session.awaitingUnlinkBotConfirm = true;
      await ctx.reply(
        "**Are you sure you want to unlink your personal bot?**\n\nType `CONFIRM UNLINK` to remove your personal bot (cannot be undone).",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Cancel", callback_data: "cancel_unlinkbot" }]],
          },
        },
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

  bot.on("callback_query:data", async (ctx) => {
    if (ctx.callbackQuery.data === "cancel_unlinkbot") {
      ctx.session.awaitingUnlinkBotConfirm = false;
      await ctx.answerCallbackQuery({ text: "Unlink canceled." });
      if (ctx.callbackQuery.message) {
        try {
          await ctx.api.deleteMessage(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id);
        } catch (err) {
          logger.warn({ err }, "Failed to delete unlink confirmation message");
        }
      }
      await ctx.reply("Unlink canceled.");
    }
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
      { command: "unlinkbot", description: "Remove personal bot" },
      { command: "migratechannels", description: "List legacy channels" },
    ])
    .catch((err) => logger.error({ err }, "setMyCommands failed"));
}
