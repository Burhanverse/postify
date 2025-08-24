import { Bot, InlineKeyboard } from "grammy";
import type { Message, PhotoSize, Video } from "grammy/types";
import { BotContext } from "../telegram/bot";
import { PostModel, Post } from "../models/Post";
import { ChannelModel } from "../models/Channel";
import { schedulePost } from "../services/agenda";
import { formatToHtml } from "../utils/format";
import { DateTime } from "luxon";
import { Types } from "mongoose";
import {
  requireSelectedChannel,
  requirePostPermission,
} from "../middleware/auth";
import {
  safeCommandExecution,
  safeDraftOperation,
  wrapCommand,
  validateChannelAccess,
} from "../utils/commandHelpers";
import { clearDraftSession } from "../middleware/sessionCleanup";
import { logUserActivity } from "../middleware/logging";
import { cleanupOldDraftPreview } from "../middleware/messageCleanup";
import { handleScheduleCommand, handleScheduleCallback } from "./scheduling";
import { postScheduler } from "../services/scheduler";
import { getUserChannels } from "./channels";
import { logger } from "../utils/logger";

type DraftButton = { text: string; url?: string; callbackData?: string };

export function registerPostCommands(bot: Bot<BotContext>) {
  async function renderDraftPreview(ctx: BotContext) {
    const d = ctx.session.draft;
    if (!d) return;

    const kb = new InlineKeyboard();
    // Row: type switch
    kb.text(d.postType === "text" ? "Text" : "Text", "draft:type:text")
      .text(d.postType === "photo" ? "Photo" : "Photo", "draft:type:photo")
      .text(d.postType === "video" ? "Video" : "Video", "draft:type:video")
      .row();
    kb.text("Add Button", "draft:addbtn")
      .text("Manage Buttons", "draft:managebtns")
      .row();
    kb.text("Preview", "draft:preview")
      .text("Clear", "draft:clear")
      .row();

    // Standard buttons for creating new posts
    kb.text("Send", "draft:send").text("Cancel", "draft:cancel").row();

    const caption = d.text || "(empty)";
    const existingId =
      ctx.session.controlMessageId || ctx.session.draftPreviewMessageId;
    const sendOrEdit = async () => {
      if (existingId) {
        try {
          if (
            d.mediaFileId &&
            (d.postType === "photo" || d.postType === "video")
          ) {
            await ctx.api.editMessageCaption(ctx.chat!.id, existingId, {
              caption,
              reply_markup: kb,
              parse_mode: "HTML",
            });
          } else {
            await ctx.api.editMessageText(ctx.chat!.id, existingId, caption, {
              reply_markup: kb,
              parse_mode: "HTML",
            });
          }
          ctx.session.draftPreviewMessageId = existingId;
          ctx.session.controlMessageId = existingId;
          return;
        } catch {}
      }
      // Need to send new
      let sent;
      if (d.mediaFileId && d.postType === "photo") {
        sent = await ctx.replyWithPhoto(d.mediaFileId, {
          caption,
          reply_markup: kb,
          parse_mode: "HTML",
        });
      } else if (d.mediaFileId && d.postType === "video") {
        sent = await ctx.replyWithVideo(d.mediaFileId, {
          caption,
          reply_markup: kb,
          parse_mode: "HTML",
        });
      } else {
        sent = await ctx.reply(caption, {
          reply_markup: kb,
          parse_mode: "HTML",
        });
      }
      ctx.session.draftPreviewMessageId = sent.message_id;
      ctx.session.controlMessageId = sent.message_id;
    };
    try {
      await sendOrEdit();
      logger.debug(
        { userId: ctx.from?.id, chatId: ctx.chat?.id },
        "Draft preview rendered",
      );
    } catch (err) {
      logger.error(
        { err, userId: ctx.from?.id, chatId: ctx.chat?.id },
        "Failed to render draft preview",
      );
      const friendly =
        err instanceof Error && /can't parse entities|entity/i.test(err.message)
          ? "Formatting error in your text. Check unclosed <b>, <i>, <code>, <pre>, or <a> tags."
          : "Failed to update preview. Please try editing or sending text again.";
      try {
        await ctx.reply(friendly, { parse_mode: "Markdown" });
      } catch {}
    }
  }

  bot.command("usechannel", async (ctx) => {
    const idTxt = ctx.match?.trim();
    if (!idTxt) {
      await ctx.reply("Usage: /usechannel <chatId>");
      return;
    }
    const chatId = Number(idTxt);
    if (Number.isNaN(chatId)) {
      await ctx.reply("Invalid chatId");
      return;
    }
    const channel = await ChannelModel.findOne({
      chatId,
      owners: ctx.from?.id,
    });
    if (!channel) {
      await ctx.reply("Channel not found or not linked.");
      return;
    }
    ctx.session.selectedChannelChatId = chatId;
    await ctx.reply(
      `Active channel set: ${channel.title || channel.username || chatId}`,
    );
  });

  bot.command("newpost", async (ctx) => {
    // First, get user's channels
    const channels = await getUserChannels(ctx.from?.id);

    if (!channels.length) {
      await ctx.reply(
        "**No channels found!**\n\n" +
          "You need to link at least one channel before creating posts.\n" +
          "Use /addchannel to connect a channel first.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (channels.length === 1) {
      // If only one channel, auto-select it and proceed
      const channel = channels[0];
      ctx.session.selectedChannelChatId = channel.chatId;

      ctx.session.draft = { postType: "text", buttons: [] };
      delete ctx.session.draftPreviewMessageId;
      delete ctx.session.lastDraftTextMessageId;
      delete ctx.session.draftSourceMessages;
      delete ctx.session.initialDraftMessageId;

      await ctx.reply(
        `**Draft started for:** ${channel.title || channel.username || channel.chatId}\n\n` +
          "Send text to add to your draft. Use HTML tags for formatting:\n" +
          "• `<b>bold</b>` for **bold**\n" +
          "• `<i>italic</i>` for *italic*\n" +
          "• `<code>code</code>` for `code`\n" +
          "• `<pre>code block</pre>` for code blocks\n" +
          "• `<blockquote>quote</blockquote>` for quotes\n\n" +
          "Use buttons below to configure, then **Send Now** to post immediately or schedule for later:",
        { parse_mode: "Markdown" },
      );
      await renderDraftPreview(ctx);
      return;
    }

    // Multiple channels - show selection
    const keyboard = new InlineKeyboard();

    channels.forEach((channel) => {
      const displayName =
        channel.title ||
        (channel.username
          ? `@${channel.username}`
          : `Channel ${channel.chatId}`);

      keyboard.text(displayName, `newpost:select:${channel.chatId}`).row();
    });

    keyboard.text("Cancel", "newpost:cancel");

    await ctx.reply(
      "**Select a channel to create a post:**\n\n" +
        "Choose which channel you want to create a post for:",
      {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      },
    );
  });

  bot.command("addbutton", async (ctx) => {
    if (!ctx.session.draft) {
      await ctx.reply("Start a draft first with /newpost");
      return;
    }
    await ctx.reply(
      "**Add Button(s)**\n\n" +
        "Send your button(s) in this format:\n" +
        "• `Button Text | https://example.com` for URL buttons\n" +
        "• `Button Text | CALLBACK:custom_key` for callback buttons\n\n" +
        "**Single button:** `Visit Website | https://google.com`\n" +
        "**Multiple buttons (one per line):**\n" +
        "```\n" +
        "Visit Website | https://google.com\n" +
        "Contact Us | https://contact.example.com\n" +
        "Call Now | CALLBACK:call_action\n" +
        "```",
      { parse_mode: "Markdown" },
    );
    (ctx.session as Record<string, unknown>).awaitingButton = true;
  });

  bot.command("preview", async (ctx) => {
    if (!ctx.session.draft) return ctx.reply("No draft");
    delete ctx.session.draftPreviewMessageId; // Force new preview message
    await renderDraftPreview(ctx);
  });

  bot.command("clear", async (ctx) => {
    ctx.session.draft = { postType: "text", buttons: [] };
    delete ctx.session.draftPreviewMessageId;
    delete ctx.session.lastDraftTextMessageId;
    delete ctx.session.draftSourceMessages;
    delete ctx.session.initialDraftMessageId;
    await ctx.reply("Draft cleared.");
    await renderDraftPreview(ctx);
  });

  bot.command("cancel", async (ctx) => {
    delete ctx.session.draft;
    delete ctx.session.draftPreviewMessageId;
    delete ctx.session.lastDraftTextMessageId;
    delete ctx.session.draftSourceMessages;
    delete ctx.session.initialDraftMessageId;
    await ctx.reply("Draft cancelled.");
  });

  // Accept photo/video with caption (live preview update)
  bot.on(["message:photo", "message:video"], async (ctx, next) => {
    if (!ctx.session.draft || ctx.session.draftLocked) return next();
    const msg = ctx.message as Message;
    const hasPhotos = (m: Message): m is Message & { photo: PhotoSize[] } => {
      if (!("photo" in m)) return false;
      const candidate = (m as { photo?: unknown }).photo;
      return Array.isArray(candidate);
    };
    const hasVideo = (m: Message): m is Message & { video: Video } => {
      if (!("video" in m)) return false;
      const candidate = (m as { video?: unknown }).video;
      return typeof candidate === "object" && candidate !== null;
    };
    const photo = hasPhotos(msg) ? msg.photo.at(-1) : undefined;
    const video = hasVideo(msg) ? msg.video : undefined;
    if (photo) {
      ctx.session.draft.postType = "photo";
      ctx.session.draft.mediaFileId = photo.file_id;
      const cap = (msg as Partial<{ caption: string }>).caption;
      if (cap) ctx.session.draft.text = cap;
      if (ctx.session.draftPreviewMessageId) {
        try {
          await ctx.api.deleteMessage(
            ctx.chat!.id,
            ctx.session.draftPreviewMessageId,
          );
        } catch {}
        delete ctx.session.draftPreviewMessageId;
      }
      await renderDraftPreview(ctx);
      return;
    }
    if (video) {
      ctx.session.draft.postType = "video";
      ctx.session.draft.mediaFileId = video.file_id;
      const cap = (msg as Partial<{ caption: string }>).caption;
      if (cap) ctx.session.draft.text = cap;
      if (ctx.session.draftPreviewMessageId) {
        try {
          await ctx.api.deleteMessage(
            ctx.chat!.id,
            ctx.session.draftPreviewMessageId,
          );
        } catch {}
        delete ctx.session.draftPreviewMessageId;
      }
      await renderDraftPreview(ctx);
      return;
    }
    return next();
  });

  bot.on("message:text", async (ctx, next) => {
    // Button building
    // If we're in custom schedule input mode, skip draft text handling; later handler will process
    if (ctx.session.waitingForScheduleInput || ctx.session.draftLocked)
      return next();
    if (
      (ctx.session as Record<string, unknown>).awaitingButton &&
      ctx.session.draft
    ) {
      const text = ctx.message.text.trim();
      const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      let addedButtons: string[] = [];
      let errors: string[] = [];
      
      for (const line of lines) {
        const parts = line.split("|").map((p) => p.trim());
        if (parts.length >= 2) {
          const buttonText = parts[0];
          const target = parts.slice(1).join("|");
          
          if (/^https?:\/\//i.test(target)) {
            ctx.session.draft.buttons?.push({ text: buttonText, url: target });
            addedButtons.push(`"${buttonText}" (URL)`);
          } else if (/^CALLBACK:/i.test(target)) {
            const key = target.split(":")[1];
            ctx.session.draft.buttons?.push({ text: buttonText, callbackData: key });
            addedButtons.push(`"${buttonText}" (Callback)`);
          } else {
            errors.push(`Invalid target for "${buttonText}": ${target}`);
          }
        } else {
          errors.push(`Invalid format: ${line}`);
        }
      }
      
      let responseMessage = "";
      
      if (addedButtons.length > 0) {
        responseMessage += `**${addedButtons.length} button(s) added successfully**\n\n`;
        responseMessage += addedButtons.map(btn => `• ${btn}`).join('\n');
      }
      
      if (errors.length > 0) {
        if (responseMessage) responseMessage += "\n\n";
        responseMessage += `**${errors.length} error(s) encountered:**\n\n`;
        responseMessage += errors.map(err => `• ${err}`).join('\n');
        responseMessage += "\n\n**Format reminder:**\n";
        responseMessage += "• `Button Text | https://example.com` for URL buttons\n";
        responseMessage += "• `Button Text | CALLBACK:key` for callback buttons";
      }
      
      if (!responseMessage) {
        responseMessage = "**No valid buttons found**\n\nPlease use the correct format:\n";
        responseMessage += "• `Button Text | https://example.com` for URL buttons\n";
        responseMessage += "• `Button Text | CALLBACK:key` for callback buttons";
      }
      
      await ctx.reply(responseMessage, { parse_mode: "Markdown" });
      delete (ctx.session as Record<string, unknown>).awaitingButton;
      return;
    }
    if (ctx.session.draft) {
      const msgId = ctx.message.message_id;
      const html = formatToHtml(ctx.message.text);
      if (!ctx.session.initialDraftMessageId) {
        // First message establishes the draft text
        ctx.session.initialDraftMessageId = msgId;
        ctx.session.draft.text = html;
      } else if (ctx.session.initialDraftMessageId === msgId) {
        // Subsequent edit will not arrive here (will use edited_message), ignore duplicate send
        return;
      } else {
        // Additional messages append
        ctx.session.draft.text = ctx.session.draft.text
          ? ctx.session.draft.text + "\n" + html
          : html;
      }
      await renderDraftPreview(ctx);
      return;
    }
    return next();
  });

  // Handle edited text messages for drafts
  bot.on("edited_message:text", async (ctx, next) => {
    if (
      !ctx.session.draft ||
      !ctx.session.initialDraftMessageId ||
      ctx.session.draftLocked
    )
      return next();
    if (ctx.editedMessage.message_id === ctx.session.initialDraftMessageId) {
      ctx.session.draft.text = formatToHtml(ctx.editedMessage.text);
      await renderDraftPreview(ctx);
    }
    return next();
  });

  // Callback interactions for draft editing
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    // Handle newpost channel selection
    if (data?.startsWith("newpost:")) {
      const [, action, value] = data.split(":");

      if (action === "select") {
        const chatId = Number(value);
        const channel = await ChannelModel.findOne({
          chatId,
          owners: ctx.from?.id,
        });

        if (!channel) {
          await ctx.answerCallbackQuery();
          await ctx.editMessageText(
            "**Error:** Channel not found or access denied.\n\nPlease use /addchannel to link a valid channel.",
            { parse_mode: "Markdown" },
          );
          return;
        }

        // Set selected channel and start draft
        ctx.session.selectedChannelChatId = chatId;
        ctx.session.draft = { postType: "text", buttons: [] };
        delete ctx.session.draftPreviewMessageId;
        delete ctx.session.lastDraftTextMessageId;
        delete ctx.session.draftSourceMessages;
        delete ctx.session.initialDraftMessageId;

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
          `**Channel Selected:** ${channel.title || channel.username || chatId}\n\n` +
            "**Draft started!**\n\n" +
            "Send text to add to your draft. Use HTML tags for formatting:\n" +
            "• \`<b>bold</b>\` for **bold**\n" +
            "• \`<i>italic</i>\` for *italic*\n" +
            "• \`<code>code</code>\` for \`code\`\n" +
            "• \`<pre>code block</pre>\` for code blocks\n" +
            "• \`<blockquote>quote</blockquote>\` for quotes\n\n" +
            "Use buttons below to configure, then **Send Now** to post immediately or schedule for later:",
          { parse_mode: "Markdown" },
        );
        await renderDraftPreview(ctx);
        return;
      }

      if (action === "cancel") {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
          "**Post creation cancelled.**\n\nUse /newpost to start a new post.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      return;
    }

    // Handle scheduling callbacks
    if (
      data &&
      (await handleScheduleCallback(
        ctx,
        data.split(":")[0],
        data.split(":").slice(1).join(":"),
      ))
    ) {
      return;
    }

    // Handle general action callbacks
    if (data === "new_post" || data === "new_post_quick") {
      await ctx.answerCallbackQuery();
      // Clear any existing draft to start fresh
      ctx.session.draft = { postType: "text", buttons: [] };
      delete ctx.session.draftPreviewMessageId;
      delete ctx.session.lastDraftTextMessageId;
      delete ctx.session.draftSourceMessages;
      delete ctx.session.initialDraftMessageId;
      delete ctx.session.selectedChannelChatId;

      // Trigger new post flow - call the newpost command handler logic
      const channels = await getUserChannels(ctx.from?.id);

      if (!channels || channels.length === 0) {
        await ctx.editMessageText(
          "**No channels found**\n\nPlease add channels first using /addchannel.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      channels.forEach((channel) => {
        const displayName =
          channel.title || channel.username || channel.chatId.toString();
        keyboard.text(displayName, `newpost:select:${channel.chatId}`).row();
      });
      keyboard.text("Cancel", "newpost:cancel");

      await ctx.editMessageText(
        "**Create New Post**\n\n" + "Select a channel to post to:",
        { reply_markup: keyboard, parse_mode: "Markdown" },
      );
      return;
    }

    if (data === "close_message") {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage();
      return;
    }

    if (!data?.startsWith("draft:")) return next();
    if (!ctx.session.draft) {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "**No draft found**\n\nPlease start a new post with /newpost first.",
        { parse_mode: "Markdown" },
      );
      return;
    }
    const [, action, value] = data.split(":");
    if (action === "type") {
      ctx.session.draft.postType = value as "text" | "photo" | "video";
      if (value === "text") delete ctx.session.draft.mediaFileId;
      delete ctx.session.lastDraftTextMessageId;
      delete ctx.session.draftSourceMessages;
      delete ctx.session.initialDraftMessageId;
      await ctx.answerCallbackQuery();
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "send") {
      // Lock draft so no further content modifications are ingested while user chooses now vs schedule
      ctx.session.draftLocked = true;
      const kb = new InlineKeyboard()
        .text("Now", "draft:sendnow")
        .text("Schedule", "draft:schedule")
        .row()
        .text("Back", "draft:back");
      try {
        if (ctx.session.draftPreviewMessageId) {
          await ctx.api.editMessageReplyMarkup(
            ctx.chat!.id,
            ctx.session.draftPreviewMessageId,
            { reply_markup: kb },
          );
        } else {
          await ctx.editMessageReplyMarkup({ reply_markup: kb });
        }
      } catch {}
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === "managebtns") {
      const buttons = ctx.session.draft.buttons || [];
      if (!buttons.length) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**No buttons found**\n\nAdd buttons first using the Add Button option or /addbutton command.",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const kbList = new InlineKeyboard();
      buttons.forEach((b, i) => {
        kbList.text(`${i + 1}. ${b.text}`, `draft:showbtn:${i}`).row();
      });
      kbList.text("Back", "draft:back");
      await ctx.editMessageReplyMarkup({ reply_markup: kbList });
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === "addbtn") {
      (ctx.session as Record<string, unknown>).awaitingButton = true;
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "**Add Button(s)**\n\n" +
          "Send your button(s) in this format:\n" +
          "• `Button Text | https://example.com` for URL buttons\n" +
          "• `Button Text | CALLBACK:custom_key` for callback buttons\n\n" +
          "**Single button:** `Visit Website | https://google.com`\n" +
          "**Multiple buttons (one per line):**\n" +
          "```\n" +
          "Visit Website | https://google.com\n" +
          "Contact Us | https://contact.example.com\n" +
          "Call Now | CALLBACK:call_action\n" +
          "```",
        { parse_mode: "Markdown" },
      );
      return;
    }
    if (action === "showbtn") {
      const idx = Number(value);
      const btn = ctx.session.draft.buttons?.[idx];
      if (!btn) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Button not found**\n\nThe selected button no longer exists.",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const kbBtn = new InlineKeyboard()
        .text("Edit", `draft:editbtn:${idx}`)
        .text("Remove", `draft:delbtn:${idx}`)
        .row()
        .text("Buttons", "draft:managebtns");
      await ctx.editMessageReplyMarkup({ reply_markup: kbBtn });
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === "delbtn") {
      const idx = Number(value);
      const deletedButton = ctx.session.draft.buttons?.[idx];
      if (ctx.session.draft.buttons) ctx.session.draft.buttons.splice(idx, 1);
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `**Button removed**\n\nDeleted: "${deletedButton?.text || "Unknown button"}"`,
        { parse_mode: "Markdown" },
      );
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "editbtn") {
      const idx = Number(value);
      const btn = ctx.session.draft.buttons?.[idx];
      ctx.session.draftEditMode = "button";
      (ctx.session as Record<string, unknown>).editingButtonIndex = idx;
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `**Edit Button: "${btn?.text || "Unknown"}"**\n\n` +
          "Send the new button in this format:\n" +
          "• `Button Text | https://example.com` for URL buttons\n" +
          "• `Button Text | CALLBACK:custom_key` for callback buttons\n\n" +
          "**Current:** ${btn?.url ? `URL button to ${btn.url}` : btn?.callbackData ? `Callback button (${btn.callbackData})` : 'Unknown type'}",
        { parse_mode: "Markdown" },
      );
      return;
    }
    if (action === "back") {
      await ctx.answerCallbackQuery();
      // Unlock draft editing when user returns
      delete ctx.session.draftLocked;
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "clear") {
      ctx.session.draft = { postType: "text", buttons: [] };
      delete ctx.session.lastDraftTextMessageId;
      delete ctx.session.draftSourceMessages;
      delete ctx.session.initialDraftMessageId;
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "**Draft cleared**\n\nYour draft has been reset. You can start adding content again.",
        { parse_mode: "Markdown" },
      );
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "cancel") {
      delete ctx.session.draft;
      delete ctx.session.draftPreviewMessageId;
      delete ctx.session.lastDraftTextMessageId;
      delete ctx.session.draftSourceMessages;
      delete ctx.session.initialDraftMessageId;
      delete ctx.session.draftLocked;
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "**Draft cancelled**\n\nYour draft has been discarded. Use /newpost to start over.",
        { parse_mode: "Markdown" },
      );
      return;
    }
    if (action === "schedule") {
      await ctx.answerCallbackQuery();
      // Use the new enhanced scheduling interface instead of broken input mode
      await handleScheduleCommand(ctx);
      return;
    }
    if (action === "preview") {
      delete ctx.session.draftPreviewMessageId; // Force new preview message
      await ctx.answerCallbackQuery();
      if (ctx.session.draftLocked) {
        await ctx.reply(
          "Draft is locked while sending/scheduling menu is open.",
          { parse_mode: "Markdown" },
        );
        return;
      }
      // Clean up old draft preview when user explicitly requests new one
      await cleanupOldDraftPreview(ctx);
      await ctx.reply(
        "**Generating fresh preview...**\n\nCreating a new preview of your draft.",
        { parse_mode: "Markdown" },
      );
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "sendnow") {
      // Keep draft locked during send operation
      // Immediate send without scheduling
      const draft = ctx.session.draft;
      if (!draft || (!draft.text?.trim() && !draft.mediaFileId)) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Draft is empty!**\n\nAdd text or media content first before sending.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      // Check if channel is selected
      if (!ctx.session.selectedChannelChatId) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**No channel selected!**\n\nUse /newpost to select a channel first.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      const channel = await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      });

      if (!channel) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Channel not found!**\n\nPlease use /newpost to select a valid channel.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      // Ensure channel is bound to a personal bot (post-migration requirement)
      if (!channel.botId) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Channel missing personal bot link**\n\nRelink this channel via your *personal bot* using /addchannel inside that bot chat.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      // Quick active personal bot record check before creating DB post
      const { UserBotModel } = await import("../models/UserBot");
      const userBotRecord = await UserBotModel.findOne({
        botId: channel.botId,
        status: "active",
      });
      if (!userBotRecord) {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Personal bot inactive**\n\nStart or re-add your personal bot first (use /mybot to verify status).",
          { parse_mode: "Markdown" },
        );
        return;
      }

      // Provide immediate feedback (avoid silent wait on network)
      try {
        await ctx.answerCallbackQuery({ text: "Sending…" });
      } catch {}

      try {
        // Create the post in the database
        const post = await PostModel.create({
          channel: channel._id,
          channelChatId: channel.chatId,
          authorTgId: ctx.from?.id,
          status: "draft", // Create as draft first
          type: draft.postType || "text",
          text: draft.text?.trim() || undefined,
          mediaFileId: draft.mediaFileId || undefined,
          buttons: draft.buttons || [],
        });

        console.log("Created post:", post._id.toString());

        // Publish immediately using the publisher service
        const { publishPost } = await import("../services/publisher");
        await publishPost(post as Post & { _id: Types.ObjectId });

        console.log("Published post successfully");

        // Clear draft session
        delete ctx.session.draft;
        delete ctx.session.draftPreviewMessageId;
        delete ctx.session.lastDraftTextMessageId;
        delete ctx.session.draftSourceMessages;
        delete ctx.session.initialDraftMessageId;
        delete ctx.session.draftLocked;

        await ctx.answerCallbackQuery();

        // Check if the current message has media content
        const successMessage = `**Post sent successfully!**\n\nYour post has been published to: ${channel.title || channel.username || channel.chatId}`;

        try {
          if (
            draft.mediaFileId &&
            (draft.postType === "photo" || draft.postType === "video")
          ) {
            // Media – cannot edit original draft control message reliably; send new success message
            await ctx.reply(successMessage, { parse_mode: "Markdown" });
          } else {
            // Text – edit the control/preview message if possible
            try {
              await ctx.editMessageText(successMessage, {
                parse_mode: "Markdown",
              });
            } catch {
              await ctx.reply(successMessage, { parse_mode: "Markdown" });
            }
          }
        } catch {
          await ctx.reply(successMessage, { parse_mode: "Markdown" });
        }
      } catch (error) {
        console.error("Send now error:", error);
        try {
          await ctx.answerCallbackQuery();
        } catch {}
        // Unlock to let user adjust after failure
        delete ctx.session.draftLocked;

        // Try to provide more specific error information
        const sendErrorMessage = async (message: string) => {
          try {
            if (
              draft.mediaFileId &&
              (draft.postType === "photo" || draft.postType === "video")
            ) {
              await ctx.reply(message, { parse_mode: "Markdown" });
            } else {
              await ctx.editMessageText(message, { parse_mode: "Markdown" });
            }
          } catch {
            await ctx.reply(message, { parse_mode: "Markdown" });
          }
        };

        if (error instanceof Error) {
          if (error.message.includes("chat not found")) {
            await sendErrorMessage(
              "**Error: Channel not found**\n\nPlease re-add the channel with /addchannel",
            );
          } else if (
            error.message.includes("not enough rights") ||
            error.message.includes("lacks posting rights")
          ) {
            await sendErrorMessage(
              "**Error: Insufficient permissions**\n\nPersonal bot lacks permission to post. Make sure your personal bot is still an admin with posting rights.",
            );
          } else if (
            error.message.includes("personal bot") ||
            error.message.includes("Personal bot inactive")
          ) {
            await sendErrorMessage(
              "**Personal bot issue**\n\nVerify your personal bot is running (/botstatus) and relink the channel via that bot /addchannel.",
            );
          } else {
            await sendErrorMessage(`**Error occurred**\n\n${error.message}`);
          }
        } else {
          await sendErrorMessage(
            "**Unknown error occurred**\n\nPlease try again or contact support.",
          );
        }
      }
      return;
    }
  });

  // Handle custom scheduling input
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.session.waitingForScheduleInput) return next();

    const timeInput = ctx.message.text.trim();

    // Clear the waiting flag
    ctx.session.waitingForScheduleInput = false;

    // Persist last custom schedule input
    if (ctx.from?.id) {
      const { UserModel } = await import("../models/User");
      UserModel.findOneAndUpdate(
        { tgId: ctx.from.id },
        { $set: { "preferences.lastCustomScheduleInput": timeInput } },
      ).catch(() => {});
    }

    // Process the scheduling input
    await handleScheduleCommand(ctx, timeInput);
    return;
  });

  // Capture button add & scheduling inputs
  bot.on("message:text", async (ctx, next) => {
    if (!ctx.session.draft || !ctx.session.draftEditMode) return next();
    const mode = ctx.session.draftEditMode;
    const text = ctx.message.text.trim();
    if (mode === "button") {
      const parts = text.split("|").map((p) => p.trim());
      if (parts.length >= 2) {
        const btxt = parts[0];
        const target = parts.slice(1).join("|");
        const idx = (ctx.session as Record<string, unknown>)
          .editingButtonIndex as number | undefined;
        let newBtn:
          | { text: string; url: string }
          | { text: string; callbackData: string }
          | undefined;
        if (/^https?:\/\//i.test(target)) newBtn = { text: btxt, url: target };
        else if (/^CALLBACK:/i.test(target))
          newBtn = { text: btxt, callbackData: target.split(":")[1] };
        if (!newBtn) {
          await ctx.reply("Unrecognized target. Use URL or CALLBACK:key");
          return;
        }
        if (
          Number.isInteger(idx) &&
          typeof idx === "number" &&
          ctx.session.draft.buttons &&
          idx >= 0 &&
          idx < ctx.session.draft.buttons.length
        ) {
          ctx.session.draft.buttons[idx] = newBtn as DraftButton;
          await ctx.reply(
            `**Button updated**\n\nUpdated: "${newBtn.text}"`,
            { parse_mode: "Markdown" },
          );
        } else {
          ctx.session.draft.buttons?.push(newBtn as DraftButton);
          await ctx.reply(`**Button added**\n\nAdded: "${newBtn.text}"`, {
            parse_mode: "Markdown",
          });
        }
        ctx.session.draftEditMode = null;
        delete (ctx.session as Record<string, unknown>).editingButtonIndex;
        await renderDraftPreview(ctx);
        return;
      } else {
        await ctx.reply(
          "**Invalid format**\n\nUse: `Button Text | URL` or `Button Text | CALLBACK:key`",
          { parse_mode: "Markdown" },
        );
        return;
      }
    }
    return next();
  });

  // Enhanced schedule command with improved validation and UX
  bot.command(
    "schedule",
    requireSelectedChannel(),
    requirePostPermission(),
    wrapCommand(async (ctx) => {
      const args = typeof ctx.match === "string" ? ctx.match.trim() : "";
      await handleScheduleCommand(ctx, args);
    }, "schedule"),
  );

  // Enhanced queue command with better UX and pagination
  bot.command("queue", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Authentication required.");
      return;
    }

    try {
      // Get user's selected channel or first available channel
      let channelId: string | undefined;

      if (ctx.session?.selectedChannelChatId) {
        const channel = await ChannelModel.findOne({
          chatId: ctx.session.selectedChannelChatId,
          owners: userId,
        });
        if (channel) {
          channelId = channel._id.toString();
        }
      }

      if (!channelId) {
        const channel = await ChannelModel.findOne({ owners: userId });
        if (!channel) {
          await ctx.reply(
            "**No channels found**\n\nUse /addchannel to link a channel first.",
            { parse_mode: "Markdown" },
          );
          return;
        }
        channelId = channel._id.toString();
      }

      // Get scheduled posts using the enhanced scheduler
      const result = await postScheduler.getScheduledPosts({
        userId,
        channelId,
        limit: 15,
        sortBy: "scheduledAt",
        sortOrder: "asc",
      });

      if (result.posts.length === 0) {
        await ctx.reply(
          "**Queue is empty**\n\nNo posts are currently scheduled for this channel.\n\nUse /newpost to create and schedule a new post.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      // Build response with enhanced formatting
      const channel = await ChannelModel.findById(channelId);
      const channelName =
        channel?.title || channel?.username || channel?.chatId || "Unknown";

      let response = `**Scheduled Posts for ${channelName}**\n`;
      response += `(${result.total} total scheduled)\n\n`;

      result.posts.forEach((post, index) => {
        const scheduledTime = DateTime.fromJSDate(post.scheduledAt!);
        const timeDisplay = scheduledTime.toFormat("MMM dd, HH:mm");
        const relativeTime = scheduledTime.toRelative();

        const preview = post.text
          ? post.text.length > 50
            ? post.text.substring(0, 50) + "..."
            : post.text
          : `${post.type} post`;

        response += `${index + 1}. **${preview}**\n`;
        response += `   ${timeDisplay} UTC (${relativeTime})\n`;
        response += `   ID: \`${post._id.toString()}\`\n\n`;
      });

      if (result.hasMore) {
        response += `_Showing first ${result.posts.length} posts. Use pagination for more._`;
      }

      // Add interactive buttons
      const keyboard = new InlineKeyboard()
        .text("Refresh", "queue_refresh")
        .text("Stats", "queue_stats")
        .row()
        .text("New Post", "new_post_quick")
        .text("Close", "close_message");

      await ctx.reply(response, {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
        },
        "Error in enhanced queue command",
      );

      await ctx.reply("**Error loading queue**\n\nPlease try again later.", {
        parse_mode: "Markdown",
      });
    }
  });

  bot.command("listposts", async (ctx) => {
    let channel;

    if (ctx.session.selectedChannelChatId) {
      channel = await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      });
    }

    if (!channel) {
      channel = await ChannelModel.findOne({ owners: ctx.from?.id });
    }

    if (!channel) {
      await ctx.reply(
        "No linked channel. Use /addchannel to link a channel first.",
      );
      return;
    }

    const [scheduled, published] = await Promise.all([
      PostModel.find({ channel: channel._id, status: "scheduled" })
        .sort({ scheduledAt: 1 })
        .limit(5),
      PostModel.find({ channel: channel._id, status: "published" })
        .sort({ publishedAt: -1 })
        .limit(5),
    ]);

    let response = `**Posts for:** ${channel.title || channel.username || channel.chatId}\n\n`;

    if (scheduled.length > 0) {
      response += "**Scheduled Posts:**\n";
      scheduled.forEach((p, index) => {
        const preview = p.text
          ? p.text.length > 40
            ? p.text.substring(0, 40) + "..."
            : p.text
          : "(No text)";
        response += `${index + 1}. ${preview}\n`;
      });
      response += "\n";
    }

    if (published.length > 0) {
      response += "**Published Posts:**\n";
      published.forEach((p, index) => {
        const preview = p.text
          ? p.text.length > 40
            ? p.text.substring(0, 40) + "..."
            : p.text
          : "(No text)";
        response += `${index + 1}. ${preview}\n`;
      });
    }

    if (scheduled.length === 0 && published.length === 0) {
      response += "No posts found. Create your first post with /newpost";
    }

    await ctx.reply(response, { parse_mode: "Markdown" });
  });
}
