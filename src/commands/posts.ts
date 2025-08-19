import { Bot, InlineKeyboard } from "grammy";
import type { Message, PhotoSize, Video } from "grammy/types";
import { BotContext } from "../telegram/bot";
import { PostModel } from "../models/Post";
import { ChannelModel } from "../models/Channel";
import { schedulePost, scheduleRecurring } from "../services/agenda";
import { formatToHtml } from "../utils/format";
import { DateTime } from "luxon";
import { Types } from "mongoose";

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
  ctx.session.draft = { postType: "text", buttons: [] };
    delete ctx.session.draftPreviewMessageId;
  delete ctx.session.lastDraftTextMessageId;
  delete ctx.session.draftSourceMessages;
  delete ctx.session.initialDraftMessageId;
    await ctx.reply(
      "📝 **Interactive draft started!**\n\n" +
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
        }
      } catch {}
      await ctx.answerCallbackQuery();
      return;
    }
    if (action === "send") {
      // Show send submenu
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
      if (!ctx.session.draft?.text && !ctx.session.draft?.mediaFileId) {
        await ctx.answerCallbackQuery({ text: "Draft is empty! Add text or media first." });
        return;
      }
      
      const channel = await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      }) || await ChannelModel.findOne({ owners: ctx.from?.id });
      
      if (!channel) {
        await ctx.answerCallbackQuery({ text: "No linked channel! Use /addchannel first." });
        return;
      }
      
      try {
        const post = await PostModel.create({
          channel: channel._id,
          channelChatId: channel.chatId,
          authorTgId: ctx.from?.id,
          status: "published",
          type: ctx.session.draft.postType || "text",
          text: ctx.session.draft.text,
          mediaFileId: ctx.session.draft.mediaFileId,
          buttons: ctx.session.draft.buttons,
          publishedAt: new Date(),
        });
        
        // Publish immediately using the publisher service
        const { publishPost } = await import("../services/publisher");
  await publishPost(post as unknown as (import("../models/Post").Post & { _id: Types.ObjectId }));
        
  delete ctx.session.draft;
        delete ctx.session.draftPreviewMessageId;
        delete ctx.session.lastDraftTextMessageId;
  delete ctx.session.draftSourceMessages;
  delete ctx.session.initialDraftMessageId;
        
        await ctx.answerCallbackQuery({ text: "✅ Posted successfully!" });
        await ctx.editMessageText("✅ Post sent successfully to channel!");
      } catch (error) {
        await ctx.answerCallbackQuery({ text: "❌ Failed to send post" });
      }
      return;
    }
    if (action === "save") {
      await ctx.answerCallbackQuery({ text: "Use Send Now, Schedule, or Recurring" });
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

  bot.command("schedule", async (ctx) => {
    if (!ctx.session.draft) return ctx.reply("No draft. /newpost first.");
    if (!ctx.session.draft.text && !ctx.session.draft.mediaFileId)
      return ctx.reply("Draft empty. Add text or media.");
    const args = ctx.match?.trim();
    let minutes = 2;
    let date: Date | undefined;
    if (args) {
      // parse "in <minutes>" or ISO date
      if (/^in \d+$/i.test(args)) {
        minutes = Number(args.split(/\s+/)[1]);
      } else if (!isNaN(Date.parse(args))) {
        date = new Date(args);
      }
    }
    const when = date || DateTime.utc().plus({ minutes }).toJSDate();
    const channel =
      (await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      })) || (await ChannelModel.findOne({ owners: ctx.from?.id }));
    if (!channel) return ctx.reply("No linked channel. /addchannel first.");
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
    delete ctx.session.draft;
    await ctx.reply(`Post scheduled for ${when.toISOString()}`);
  });

  bot.command("recurring", async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) return ctx.reply("Usage: /recurring <cron> (UTC)");
    if (!ctx.session.draft) return ctx.reply("Create a draft first.");
    if (!ctx.session.draft.text && !ctx.session.draft.mediaFileId)
      return ctx.reply("Draft empty. Add text or media.");
    const channel =
      (await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      })) || (await ChannelModel.findOne({ owners: ctx.from?.id }));
    if (!channel) return ctx.reply("No linked channel.");
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
    delete ctx.session.draft;
    await ctx.reply(`Recurring post scheduled with cron: ${args}`);
  });

  bot.command("editpost", async (ctx) => {
    const arg = ctx.match?.trim();
    if (!arg) return ctx.reply("Usage: /editpost <postId>");
    const post = await PostModel.findById(arg);
    if (!post) return ctx.reply("Post not found");
    if (post.status !== "scheduled")
      return ctx.reply("Only scheduled drafts can be edited");
    ctx.session.draft = {
      postType: post.type as "text" | "photo" | "video",
      text: post.text || undefined,
      mediaFileId: post.mediaFileId || undefined,
      buttons: post.buttons as unknown as {
        text: string;
        url?: string;
        callbackData?: string;
      }[],
    };
    await ctx.reply(
      "Loaded draft for editing. Modify and /schedule again to update (old schedule persists time unless you reschedule).",
    );
  });

  bot.command("deletepost", async (ctx) => {
    const arg = ctx.match?.trim();
    if (!arg) return ctx.reply("Usage: /deletepost <postId>");
    const post = await PostModel.findById(arg);
    if (!post) return ctx.reply("Not found");
    if (post.status === "published")
      return ctx.reply("Already published (use channel delete manually).");
    await PostModel.deleteOne({ _id: post._id });
    await ctx.reply("Post deleted.");
  });

  bot.command("queue", async (ctx) => {
    const channel = await ChannelModel.findOne({ owners: ctx.from?.id });
    if (!channel) {
      await ctx.reply("No linked channel.");
      return;
    }
    const upcoming = await PostModel.find({
      channel: channel._id,
      status: "scheduled",
    })
      .sort({ scheduledAt: 1 })
      .limit(10);
    if (!upcoming.length) {
      await ctx.reply("Queue empty.");
      return;
    }
    await ctx.reply(
      upcoming
        .map(
          (p) =>
            `${(p._id as unknown as string).toString()} -> ${p.recurrence?.cron ? "(cron " + p.recurrence.cron + ")" : p.scheduledAt?.toISOString()}`,
        )
        .join("\n"),
    );
  });
}
