import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";
import { UserBotModel } from "../models/UserBot";
import { getOrCreateUserBot } from "../services/userBotRegistry";
import { encrypt } from "../utils/crypto";
import { validateBotTokenFormat } from "../utils/tokens";
import { getPackageInfo } from "../utils/packageInfo";

const packageInfo = getPackageInfo();

const BOT_INFO = {
  name: "Postify",
  version: packageInfo.version,
  description: packageInfo.description,
  developer: "Burhanverse",
  owner: "Burhanverse",
  sourceCode: "https://github.com/Burhanverse/postify",
  mainBotUsername: "PostifyxBot",
};

// Helper function to create the about/start message
async function createAboutMessage(
  ctx: BotContext,
  isPersonalBot = false,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const text =
    `<b>${BOT_INFO.name}</b> is a ` +
    `<i>${BOT_INFO.description}</i>\n\n` +
    `<b>Version:</b><i> ${BOT_INFO.version}</i>\n` +
    `<b>Developer:</b><i> ${BOT_INFO.developer}</i>\n` +
    `<b>Owner:</b><i> ${BOT_INFO.owner}</i>\n\n` +
    `<blockquote>Key Features:\n` +
    `• Channel management (public & private)\n` +
    `• Draft creation with text, media & buttons\n` +
    `• Post scheduling with timezone support\n` +
    `• Send & pin functionality\n` +
    `• Multiple channels per user\n` +
    `• Personal bot integration</blockquote>\n\n` +
    `${isPersonalBot ? "<i>This is your Personal Bot instance</i>" : "<i>This is the Main Bot instance</i>"}`;

  const keyboard = new InlineKeyboard();

  // Features button
  keyboard.text("Help & Features", "about:features").row();

  // Source code button
  keyboard.url("Source Code", BOT_INFO.sourceCode).row();

  // Main bot button (only for personal bots)
  if (isPersonalBot) {
    keyboard
      .url("Open Postify Bot", `https://t.me/${BOT_INFO.mainBotUsername}`)
      .row();
  }

  // Close button
  keyboard.text("Close", "about:close");

  return { text, keyboard };
}

// Helper function to create help message
function createHelpMessage(isPersonalBot = false): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const mainBotCmds =
    `<i>Main Bot Commands:</i>\n` +
    `<blockquote>• <code>/start</code> or <code>/about</code> - Show bot information\n` +
    `• <code>/addbot</code> - Register your personal bot\n` +
    `• <code>/mybot</code> - Show personal bot status\n` +
    `• <code>/unlinkbot</code> - Remove personal bot\n\n</blockquote>`;

  const personalBotCmds =
    `<i>Personal Bot Commands:</i>\n` +
    `<blockquote>• <code>/addchannel</code> - Link channels to this bot\n` +
    `• <code>/channels</code> - List linked channels\n` +
    `• <code>/checkchannels</code> - Check channel status\n` +
    `• <code>/newpost</code> - Create and manage posts\n` +
    `• <code>/preview</code> - Force regenerate preview of the post\n` +
    `• <code>/queue</code> - View scheduled posts\n` +
    `• <code>/timezone</code> - Set your timezone\n\n</blockquote>`;

  const workflowText =
    `<i>Getting Started Workflow:</i>\n` +
    `<blockquote>1. Use main bot to register your personal bot (/addbot)\n` +
    `2. Add your personal bot as admin to your channels\n` +
    `3. Use personal bot to link channels (/addchannel)\n` +
    `4. Create and schedule posts (/newpost)</blockquote>\n\n`;

  const text =
    `<b>Help:</b>\n\n` +
    (isPersonalBot
      ? personalBotCmds + mainBotCmds + workflowText
      : mainBotCmds + personalBotCmds + workflowText) +
    `<i>Tips:</i>\n` +
    `<blockquote>• Personal bots handle channel operations\n` +
    `• Main bot manages bot registration\n` +
    `• Use HTML formatting in posts\n` +
    `• Schedule posts with custom timezone</blockquote>`;

  const keyboard = new InlineKeyboard()
    .text("Back", "about:features")
    .row()
    .text("Close", "about:close");

  return { text, keyboard };
}

// Helper function to create features message
function createFeaturesMessage(isPersonalBot = false): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const text =
    `<b>Features:</b>\n\n` +
    `<i>Channel Management:</i>\n` +
    `<blockquote>• Link unlimited channels (public & private)\n` +
    `• Check channel status and permissions\n` +
    `• Pin posts after sending\n` +
    `• Multi-channel post broadcasting\n\n</blockquote>` +
    `<i>Content Creation:</i>\n` +
    `<blockquote>• Rich text formatting with HTML support\n` +
    `• Media attachments (photos, videos, documents)\n` +
    `• Interactive inline buttons\n\n</blockquote>` +
    `<i>Native & Smart Scheduling:</i>\n` +
    `<blockquote>• Schedule posts for future delivery\n` +
    `• Custom timezone support\n` +
    `• Queue management and viewing\n` +
    `• Automatic post publishing\n\n</blockquote>` +
    `<i>Personal Bot Integration:</i>\n` +
    `<blockquote>• Your own dedicated bot instance\n` +
    `• Complete channel control\n` +
    `• Private token management (encrypted with AES-256-GCM)\n` +
    `• Independent operation\n\n</blockquote>`;

  const keyboard = new InlineKeyboard()
    .text("Help", "about:help")
    .row()
    .text("Back", "about:back")
    .row()
    .text("Close", "about:close");

  return { text, keyboard };
}

// Enhanced start/about command with comprehensive information
export function addStartCommand(bot: Bot<BotContext>, isPersonalBot = false) {
  bot.command(["start", "about"], async (ctx) => {
    try {
      const { text, keyboard } = await createAboutMessage(ctx, isPersonalBot);

      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      logger.error({ error }, "Error in start/about command");
      await ctx.reply("An error occurred while displaying bot information.");
    }
  });

  // Handle callback queries for about interactions
  bot.callbackQuery(/^about:(.+)$/, async (ctx) => {
    const action = ctx.match[1];

    try {
      switch (action) {
        case "features":
          const { text: featuresText, keyboard: featuresKeyboard } =
            createFeaturesMessage(isPersonalBot);
          await ctx.editMessageText(featuresText, {
            parse_mode: "HTML",
            reply_markup: featuresKeyboard,
            link_preview_options: { is_disabled: true },
          });
          break;

        case "help":
          const { text: helpText, keyboard: helpKeyboard } =
            createHelpMessage(isPersonalBot);
          await ctx.editMessageText(helpText, {
            parse_mode: "HTML",
            reply_markup: helpKeyboard,
            link_preview_options: { is_disabled: true },
          });
          break;

        case "back":
          const { text: aboutText, keyboard: aboutKeyboard } =
            await createAboutMessage(ctx, isPersonalBot);
          await ctx.editMessageText(aboutText, {
            parse_mode: "HTML",
            reply_markup: aboutKeyboard,
            link_preview_options: { is_disabled: true },
          });
          break;

        case "close":
          await ctx.deleteMessage();
          break;

        default:
          await ctx.answerCallbackQuery("Unknown action");
          return;
      }

      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.error({ error }, "Error handling about callback");
      await ctx.answerCallbackQuery("An error occurred");
    }
  });
}

export function registerCoreCommands(bot: Bot<BotContext>) {
  // Add enhanced start/about command
  addStartCommand(bot, false);

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
          inline_keyboard: [
            [{ text: "Cancel", callback_data: "cancel_unlinkbot" }],
          ],
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
      await ctx.reply("Unlinked successfully. You can /addbot again anytime.");
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
          await ctx.api.deleteMessage(
            ctx.callbackQuery.message.chat.id,
            ctx.callbackQuery.message.message_id,
          );
        } catch (err) {
          logger.warn({ err }, "Failed to delete unlink confirmation message");
        }
      }
      await ctx.reply("Unlink canceled.");
    }
  });

  bot.api
    .setMyCommands([
      { command: "start", description: "Start..." },
      { command: "addbot", description: "Register personal bot" },
      { command: "mybot", description: "Show personal bot status" },
      { command: "unlinkbot", description: "Remove personal bot" },
      { command: "about", description: "About Postify Bot" },
    ])
    .catch((err) => logger.error({ err }, "setMyCommands failed"));
}
