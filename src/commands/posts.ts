import { Bot, InlineKeyboard } from "grammy";
import type { Message, PhotoSize, Video } from "grammy/types";
import { BotContext } from "../telegram/bot";
import { PostModel, Post } from "../models/Post";
import { ChannelModel } from "../models/Channel";
import { schedulePost, scheduleRecurring } from "../services/agenda";
import { formatToHtml } from "../utils/format";
import { DateTime } from "luxon";
import { Types } from "mongoose";
import { requireSelectedChannel, requirePostPermission } from "../middleware/auth";
import { 
  safeCommandExecution, 
  safeDraftOperation, 
  wrapCommand, 
  validateChannelAccess 
} from "../utils/commandHelpers";
import { clearDraftSession } from "../middleware/sessionCleanup";
import { logUserActivity } from "../middleware/logging";

type DraftButton = { text: string; url?: string; callbackData?: string };

export function registerPostCommands(bot: Bot<BotContext>) {
  async function renderDraftPreview(ctx: BotContext) {
    const d = ctx.session.draft;
    if (!d) return;
    
    const kb = new InlineKeyboard();
    // Row: type switch
    kb.text(d.postType === "text" ? "📝 Text" : "Text", "draft:type:text")
      .text(d.postType === "photo" ? "🖼 Photo" : "Photo", "draft:type:photo")
      .text(d.postType === "video" ? "🎬 Video" : "Video", "draft:type:video")
      .row();
    kb.text("➕ Button", "draft:addbtn")
      .text("✏️ Buttons", "draft:managebtns")
      .row();
    kb.text("👁 Preview", "draft:preview")
      .text("🧹 Clear", "draft:clear")
      .row();
    
    // Standard buttons for creating new posts
    kb.text("📤 Send", "draft:send")
      .text("✖️ Cancel", "draft:cancel")
      .row();

    const caption = d.text || "(empty)";
    try {
      if (ctx.session.draftPreviewMessageId) {
        // edit existing
        if (d.mediaFileId && d.postType === "photo") {
          await ctx.api.editMessageCaption(
            ctx.chat!.id,
            ctx.session.draftPreviewMessageId,
            { caption, reply_markup: kb, parse_mode: "HTML" },
          );
        } else if (d.mediaFileId && d.postType === "video") {
          await ctx.api.editMessageCaption(
            ctx.chat!.id,
            ctx.session.draftPreviewMessageId,
            { caption, reply_markup: kb, parse_mode: "HTML" },
          );
        } else {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            ctx.session.draftPreviewMessageId,
            caption,
            { reply_markup: kb, parse_mode: "HTML" },
          );
        }
      } else {
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
          sent = await ctx.reply(caption, { reply_markup: kb, parse_mode: "HTML" });
        }
        ctx.session.draftPreviewMessageId = sent.message_id;
      }
    } catch (err) {
      // fallback: re-send if edit failed due to type switch
      try {
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
          sent = await ctx.reply(caption, { reply_markup: kb, parse_mode: "HTML" });
        }
        ctx.session.draftPreviewMessageId = sent.message_id;
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
    const channels = await ChannelModel.find({ owners: ctx.from?.id });
    
    if (!channels.length) {
      await ctx.reply(
        "❌ **No channels found!**\n\n" +
        "You need to link at least one channel before creating posts.\n" +
        "Use /addchannel to connect a channel first.",
        { parse_mode: "Markdown" }
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
        `📝 **Draft started for:** ${channel.title || channel.username || channel.chatId}\n\n` +
        "Send text to add to your draft. Use HTML tags for formatting:\n" +
        "• `<b>bold</b>` for **bold**\n" +
        "• `<i>italic</i>` for *italic*\n" +
        "• `<code>code</code>` for `code`\n" +
        "• `<pre>code block</pre>` for code blocks\n" +
        "• `<blockquote>quote</blockquote>` for quotes\n\n" +
        "Use buttons below to configure, then **Send Now** to post immediately or schedule for later:",
        { parse_mode: "Markdown" }
      );
      await renderDraftPreview(ctx);
      return;
    }

    // Multiple channels - show selection
    const keyboard = new InlineKeyboard();
    
    channels.forEach((channel) => {
      const displayName = channel.title || 
                         (channel.username ? `@${channel.username}` : 
                         `Channel ${channel.chatId}`);
      
      keyboard.text(displayName, `newpost:select:${channel.chatId}`).row();
    });
    
    keyboard.text("❌ Cancel", "newpost:cancel");
    
    await ctx.reply(
      "📝 **Select a channel to create a post:**\n\n" +
      "Choose which channel you want to create a post for:",
      { 
        reply_markup: keyboard,
        parse_mode: "Markdown" 
      }
    );
  });

  bot.command("addbutton", async (ctx) => {
    if (!ctx.session.draft) {
      await ctx.reply("Start a draft first with /newpost");
      return;
    }
    await ctx.reply(
      "Send button in format: Text | URL (or) Text | CALLBACK:some_key",
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
    if (!ctx.session.draft) return next();
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
    if (
      (ctx.session as Record<string, unknown>).awaitingButton &&
      ctx.session.draft
    ) {
      const line = ctx.message.text.trim();
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 2) {
        const text = parts[0];
        const target = parts.slice(1).join("|");
        if (/^https?:\/\//i.test(target)) {
          ctx.session.draft.buttons?.push({ text, url: target });
          await ctx.reply("Button added (link).");
        } else if (/^CALLBACK:/i.test(target)) {
          const key = target.split(":")[1];
          ctx.session.draft.buttons?.push({ text, callbackData: key });
          await ctx.reply("Button added (callback).");
        } else {
          await ctx.reply("Unrecognized button format.");
        }
      } else {
        await ctx.reply("Format invalid. Use: Text | URL");
      }
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
        ctx.session.draft.text = ctx.session.draft.text ? ctx.session.draft.text + "\n" + html : html;
      }
      await renderDraftPreview(ctx);
      return;
    }
    return next();
  });

  // Handle edited text messages for drafts
  bot.on("edited_message:text", async (ctx, next) => {
    if (!ctx.session.draft || !ctx.session.initialDraftMessageId) return next();
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
          await ctx.answerCallbackQuery({ text: "Channel not found or access denied" });
          return;
        }
        
        // Set selected channel and start draft
        ctx.session.selectedChannelChatId = chatId;
        ctx.session.draft = { postType: "text", buttons: [] };
        delete ctx.session.draftPreviewMessageId;
        delete ctx.session.lastDraftTextMessageId;
        delete ctx.session.draftSourceMessages;
        delete ctx.session.initialDraftMessageId;
        
        await ctx.answerCallbackQuery({ text: `Selected: ${channel.title || channel.username || chatId}` });
        await ctx.editMessageText(
          `📝 **Draft started for:** ${channel.title || channel.username || chatId}\n\n` +
          "Send text to add to your draft. Use HTML tags for formatting:\n" +
          "• \`<b>bold</b>\` for **bold**\n" +
          "• \`<i>italic</i>\` for *italic*\n" +
          "• \`<code>code</code>\` for \`code\`\n" +
          "• \`<pre>code block</pre>\` for code blocks\n" +
          "• \`<blockquote>quote</blockquote>\` for quotes\n\n" +
          "Use buttons below to configure, then **Send Now** to post immediately or schedule for later:",
          { parse_mode: "Markdown" }
        );
        await renderDraftPreview(ctx);
        return;
      }
      
      if (action === "cancel") {
        await ctx.answerCallbackQuery({ text: "Cancelled" });
        await ctx.editMessageText("❌ Post creation cancelled.");
        return;
      }
      
      return;
    }
    
    if (!data?.startsWith("draft:")) return next();
    if (!ctx.session.draft) {
      await ctx.answerCallbackQuery({ text: "No draft" });
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
      const kb = new InlineKeyboard()
        .text("📤 Now", "draft:sendnow")
        .text("⏰ Schedule", "draft:schedule")
        .row()
        .text("🔁 Recurring", "draft:cron")
        .row()
        .text("⬅ Back", "draft:back");
      try {
        if (ctx.session.draftPreviewMessageId) {
          await ctx.api.editMessageReplyMarkup(ctx.chat!.id, ctx.session.draftPreviewMessageId, { reply_markup: kb });
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
        await ctx.answerCallbackQuery({ text: "No buttons" });
        return;
      }
      const kbList = new InlineKeyboard();
      buttons.forEach((b, i) => {
        kbList.text(`${i + 1}. ${b.text}`, `draft:showbtn:${i}`).row();
      });
      kbList.text("⬅ Back", "draft:back");
      await ctx.editMessageReplyMarkup({ reply_markup: kbList });
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === "addbtn") {
      (ctx.session as Record<string, unknown>).awaitingButton = true;
      await ctx.answerCallbackQuery({
        text: "Send: Text | URL or Text | CALLBACK:key",
        show_alert: false,
      });
      return;
    }
    if (action === "showbtn") {
      const idx = Number(value);
      const btn = ctx.session.draft.buttons?.[idx];
      if (!btn) {
        await ctx.answerCallbackQuery({ text: "Missing" });
        return;
      }
      const kbBtn = new InlineKeyboard()
        .text("🔗 Edit", `draft:editbtn:${idx}`)
        .text("🗑 Remove", `draft:delbtn:${idx}`)
        .row()
        .text("⬅ Buttons", "draft:managebtns");
      await ctx.editMessageReplyMarkup({ reply_markup: kbBtn });
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === "delbtn") {
      const idx = Number(value);
      if (ctx.session.draft.buttons) ctx.session.draft.buttons.splice(idx, 1);
      await ctx.answerCallbackQuery({ text: "Removed" });
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "editbtn") {
      const idx = Number(value);
      ctx.session.draftEditMode = "button";
      (ctx.session as Record<string, unknown>).editingButtonIndex = idx;
      await ctx.answerCallbackQuery({
        text: "Send new button: Text | URL or Text | CALLBACK:key",
      });
      return;
    }
  if (action === "back") {
      await ctx.answerCallbackQuery();
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "clear") {
  ctx.session.draft = { postType: "text", buttons: [] };
      delete ctx.session.lastDraftTextMessageId;
  delete ctx.session.draftSourceMessages;
  delete ctx.session.initialDraftMessageId;
      await ctx.answerCallbackQuery({ text: "Cleared" });
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "cancel") {
  delete ctx.session.draft;
      delete ctx.session.draftPreviewMessageId;
      delete ctx.session.lastDraftTextMessageId;
  delete ctx.session.draftSourceMessages;
  delete ctx.session.initialDraftMessageId;
      await ctx.answerCallbackQuery({ text: "Cancelled" });
      return;
    }
    if (action === "schedule") {
      ctx.session.draftEditMode = "schedule_time";
      await ctx.answerCallbackQuery({
        text: "Send schedule time: in <minutes> OR ISO date",
      });
      return;
    }
    if (action === "cron") {
      ctx.session.draftEditMode = "cron";
      await ctx.answerCallbackQuery({ text: "Send cron expression (UTC)" });
      return;
    }
    if (action === "preview") {
      delete ctx.session.draftPreviewMessageId; // Force new preview message
      await ctx.answerCallbackQuery({ text: "Generating fresh preview..." });
      await renderDraftPreview(ctx);
      return;
    }
    if (action === "sendnow") {
      // Immediate send without scheduling
      const draft = ctx.session.draft;
      if (!draft || (!draft.text?.trim() && !draft.mediaFileId)) {
        await ctx.answerCallbackQuery({ text: "Draft is empty! Add text or media first." });
        return;
      }
      
      // Check if channel is selected
      if (!ctx.session.selectedChannelChatId) {
        await ctx.answerCallbackQuery({ text: "No channel selected! Use /newpost to select a channel." });
        return;
      }
      
      const channel = await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      });
      
      if (!channel) {
        await ctx.answerCallbackQuery({ text: "Selected channel not found! Please use /newpost to select a valid channel." });
        return;
      }
      
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
        
        await ctx.answerCallbackQuery({ text: "✅ Posted successfully!" });
        await ctx.editMessageText("✅ Post sent successfully to channel!");
      } catch (error) {
        console.error("Send now error:", error);
        await ctx.answerCallbackQuery({ text: "❌ Failed to send post" });
        
        // Try to provide more specific error information
        if (error instanceof Error) {
          if (error.message.includes("chat not found")) {
            // For photo/video messages, we need to send a new message instead of editing
            if (ctx.session.draftPreviewMessageId && ctx.session.draft?.mediaFileId) {
              await ctx.reply("❌ Error: Channel not found. Please re-add the channel with /addchannel");
            } else {
              await ctx.editMessageText("❌ Error: Channel not found. Please re-add the channel with /addchannel");
            }
          } else if (error.message.includes("not enough rights")) {
            if (ctx.session.draftPreviewMessageId && ctx.session.draft?.mediaFileId) {
              await ctx.reply("❌ Error: Bot doesn't have permission to post. Grant posting rights to the bot.");
            } else {
              await ctx.editMessageText("❌ Error: Bot doesn't have permission to post. Grant posting rights to the bot.");
            }
          } else {
            if (ctx.session.draftPreviewMessageId && ctx.session.draft?.mediaFileId) {
              await ctx.reply(`❌ Error: ${error.message}`);
            } else {
              await ctx.editMessageText(`❌ Error: ${error.message}`);
            }
          }
        } else {
          if (ctx.session.draftPreviewMessageId && ctx.session.draft?.mediaFileId) {
            await ctx.reply("❌ Unknown error occurred while posting");
          } else {
            await ctx.editMessageText("❌ Unknown error occurred while posting");
          }
        }
      }
      return;
    }
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
          await ctx.reply("Button updated");
        } else {
          ctx.session.draft.buttons?.push(newBtn as DraftButton);
          await ctx.reply("Button added");
        }
        ctx.session.draftEditMode = null;
        delete (ctx.session as Record<string, unknown>).editingButtonIndex;
        await renderDraftPreview(ctx);
        return;
      } else {
        await ctx.reply("Format: Text | URL");
        return;
      }
    } else if (mode === "schedule_time") {
      ctx.session.draftEditMode = null;
      ctx.match = text as unknown as string; // reuse schedule command logic
      const sched = (
        bot as unknown as {
          commands: Map<
            string,
            { handler: (c: BotContext) => Promise<unknown> }
          >;
        }
      ).commands.get("schedule");
      if (sched) await sched.handler(ctx);
      return;
    } else if (mode === "cron") {
      ctx.session.draftEditMode = null;
      ctx.match = text as unknown as string;
      const rec = (
        bot as unknown as {
          commands: Map<
            string,
            { handler: (c: BotContext) => Promise<unknown> }
          >;
        }
      ).commands.get("recurring");
      if (rec) await rec.handler(ctx);
      return;
    }
    return next();
  });

  // Protected command with middleware
  bot.command("schedule", requireSelectedChannel(), requirePostPermission(), wrapCommand(async (ctx) => {
    if (!ctx.session.draft) {
      await ctx.reply("No draft. Create one first with /newpost");
      return;
    }
    
    if (!ctx.session.draft.text && !ctx.session.draft.mediaFileId) {
      await ctx.reply("Draft is empty. Add text or media content.");
      return;
    }
    
    const channelChatId = ctx.session.selectedChannelChatId!;
    const args = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    
    // Parse scheduling time
    let minutes = 2;
    let date: Date | undefined;
    
    if (args) {
      if (/^in \d+$/i.test(args)) {
        minutes = Number(args.split(/\s+/)[1]);
        if (minutes < 1 || minutes > 10080) { // Max 1 week
          await ctx.reply("❌ Invalid time. Use 1-10080 minutes (max 1 week).");
          return;
        }
      } else if (!isNaN(Date.parse(args))) {
        date = new Date(args);
        if (date <= new Date()) {
          await ctx.reply("❌ Scheduled time must be in the future.");
          return;
        }
      } else {
        await ctx.reply("❌ Invalid time format. Use 'in <minutes>' or ISO date string.");
        return;
      }
    }
    
    const when = date || DateTime.utc().plus({ minutes }).toJSDate();
    
    const channel = await ChannelModel.findOne({
      chatId: channelChatId,
      owners: ctx.from?.id,
    });
    
    if (!channel) {
      await ctx.reply("❌ Selected channel not found. Please select a valid channel.");
      return;
    }
    
    const post = await PostModel.create({
      channel: channel._id,
      channelChatId: channel.chatId,
      authorTgId: ctx.from?.id,
      status: "scheduled",
      type: ctx.session.draft.postType || "text",
      text: ctx.session.draft.text,
      mediaFileId: ctx.session.draft.mediaFileId,
      buttons: ctx.session.draft.buttons,
      scheduledAt: when,
    });
    
    await schedulePost((post._id as unknown as string).toString(), when, "UTC");
    
    logUserActivity(ctx.from?.id!, "post_scheduled", {
      postId: post._id.toString(),
      channelId: channel._id.toString(),
      scheduledAt: when.toISOString()
    });
    
    clearDraftSession(ctx);
    await ctx.reply(`✅ Post scheduled for ${when.toISOString()} in channel: ${channel.title || channel.username || channel.chatId}`);
  }, "schedule"));

  // Protected command with middleware
  bot.command("recurring", requireSelectedChannel(), requirePostPermission(), wrapCommand(async (ctx) => {
    const args = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!args) {
      await ctx.reply("Usage: /recurring <cron> (UTC)\nExample: /recurring '0 9 * * *' (daily at 9 AM)");
      return;
    }
    
    if (!ctx.session.draft) {
      await ctx.reply("Create a draft first with /newpost");
      return;
    }
    
    if (!ctx.session.draft.text && !ctx.session.draft.mediaFileId) {
      await ctx.reply("Draft is empty. Add text or media content.");
      return;
    }
    
    const channelChatId = ctx.session.selectedChannelChatId!;
    
    // Validate cron expression (basic validation)
    const cronParts = args.split(' ');
    if (cronParts.length !== 5) {
      await ctx.reply("❌ Invalid cron format. Use 5 parts: minute hour day month weekday\nExample: '0 9 * * *' for daily at 9 AM");
      return;
    }
    
    const channel = await ChannelModel.findOne({
      chatId: channelChatId,
      owners: ctx.from?.id,
    });
    
    if (!channel) {
      await ctx.reply("❌ Selected channel not found. Please select a valid channel.");
      return;
    }
    
    const post = await PostModel.create({
      channel: channel._id,
      channelChatId: channel.chatId,
      authorTgId: ctx.from?.id,
      status: "scheduled",
      type: ctx.session.draft.postType || "text",
      text: ctx.session.draft.text,
      mediaFileId: ctx.session.draft.mediaFileId,
      buttons: ctx.session.draft.buttons,
      recurrence: { cron: args, timezone: "UTC" },
    });
    
    await scheduleRecurring(
      (post._id as unknown as string).toString(),
      args,
      "UTC",
    );
    
    logUserActivity(ctx.from?.id!, "recurring_post_created", {
      postId: post._id.toString(),
      channelId: channel._id.toString(),
      cron: args
    });
    
    clearDraftSession(ctx);
    await ctx.reply(`✅ Recurring post scheduled with cron: ${args} for channel: ${channel.title || channel.username || channel.chatId}`);
  }, "recurring"));

  bot.command("queue", async (ctx) => {
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
      await ctx.reply("No linked channel. Use /addchannel to link a channel first.");
      return;
    }
    
    const upcoming = await PostModel.find({
      channel: channel._id,
      status: "scheduled",
    })
      .sort({ scheduledAt: 1 })
      .limit(10);
      
    if (!upcoming.length) {
      await ctx.reply(`Queue empty for channel: ${channel.title || channel.username || channel.chatId}`);
      return;
    }
    
    let response = `📅 **Scheduled Posts for:** ${channel.title || channel.username || channel.chatId}\n\n`;
    upcoming.forEach((p, index) => {
      const timeInfo = p.recurrence?.cron 
        ? `(cron: ${p.recurrence.cron})` 
        : p.scheduledAt?.toISOString() || "No time set";
      
      const preview = p.text ? 
        (p.text.length > 50 ? p.text.substring(0, 50) + "..." : p.text) : 
        "(No text)";
        
      response += `${index + 1}. **${p._id.toString()}**\n`;
      response += `   📝 ${preview}\n`;
      response += `   ⏰ ${timeInfo}\n\n`;
    });
    
    await ctx.reply(response, { parse_mode: "Markdown" });
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
      await ctx.reply("No linked channel. Use /addchannel to link a channel first.");
      return;
    }
    
    const [scheduled, published] = await Promise.all([
      PostModel.find({ channel: channel._id, status: "scheduled" })
        .sort({ scheduledAt: 1 })
        .limit(5),
      PostModel.find({ channel: channel._id, status: "published" })
        .sort({ publishedAt: -1 })
        .limit(5)
    ]);
    
    let response = `📋 **Posts for:** ${channel.title || channel.username || channel.chatId}\n\n`;
    
    if (scheduled.length > 0) {
      response += "📅 **Scheduled Posts:**\n";
      scheduled.forEach((p, index) => {
        const preview = p.text ? 
          (p.text.length > 40 ? p.text.substring(0, 40) + "..." : p.text) : 
          "(No text)";
        response += `${index + 1}. ${preview}\n`;
      });
      response += "\n";
    }
    
    if (published.length > 0) {
      response += "📢 **Published Posts:**\n";
      published.forEach((p, index) => {
        const preview = p.text ? 
          (p.text.length > 40 ? p.text.substring(0, 40) + "..." : p.text) : 
          "(No text)";
        response += `${index + 1}. ${preview}\n`;
      });
    }
    
    if (scheduled.length === 0 && published.length === 0) {
      response += "No posts found. Create your first post with /newpost";
    }
    
    await ctx.reply(response, { parse_mode: "Markdown" });
  });
}
