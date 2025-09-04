import { Bot } from "grammy";
import type { BotContext } from "../telegram/bot";
import { wrapCommand } from "../utils/commandHelpers";
import {
  requireSelectedChannel,
  requirePostPermission,
} from "../middleware/auth";
import { CallbackHandler } from "../services/callbackHandler";
import { MediaHandler } from "../services/mediaHandler";
import { TextInputHandler } from "../services/textInputHandler";
import { PostCommandHandlers } from "../services/postCommandHandlers";

export function registerPostCommands(bot: Bot<BotContext>) {
  // Handle callback queries
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery?.data;
    if (!data) return next();

    // Try to handle with the callback handler
    const handled = await CallbackHandler.handleCallback(ctx, data);
    if (handled) return;

    return next();
  });

  // Command handlers
  bot.command("usechannel", async (ctx) => {
    await PostCommandHandlers.handleUseChannel(ctx, ctx.match || "");
  });

  bot.command("newpost", async (ctx) => {
    await PostCommandHandlers.handleNewPost(ctx);
  });

  bot.command("addbutton", async (ctx) => {
    await PostCommandHandlers.handleAddButton(ctx);
  });

  bot.command("preview", async (ctx) => {
    await PostCommandHandlers.handlePreview(ctx);
  });

  bot.command("clear", async (ctx) => {
    await PostCommandHandlers.handleClear(ctx);
  });

  bot.command("cancel", async (ctx) => {
    await PostCommandHandlers.handleCancel(ctx);
  });

  bot.command("queue", async (ctx) => {
    await PostCommandHandlers.handleQueue(ctx);
  });

  bot.command("listposts", async (ctx) => {
    await PostCommandHandlers.handleListPosts(ctx);
  });

  // Media handlers
  bot.on(["message:photo", "message:video"], async (ctx, next) => {
    const msg = ctx.message;

    // Try photo first
    if ("photo" in msg && (await MediaHandler.handlePhotoMessage(ctx, msg))) {
      return;
    }

    // Try video
    if ("video" in msg && (await MediaHandler.handleVideoMessage(ctx, msg))) {
      return;
    }

    return next();
  });

  // Text message handlers
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;

    if (await TextInputHandler.handleTextInput(ctx, text)) {
      return;
    }

    return next();
  });

  // Handle edited text messages for drafts
  bot.on("edited_message:text", async (ctx, next) => {
    const text = ctx.editedMessage.text;

    if (await TextInputHandler.handleEditedText(ctx, text)) {
      return;
    }

    return next();
  });
}
