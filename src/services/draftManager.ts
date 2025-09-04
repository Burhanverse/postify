import { InlineKeyboard } from "grammy";
import type { BotContext } from "../telegram/bot";
import { formatToHtml } from "../utils/format";
import { logger } from "../utils/logger";
import {
  clearAllDraftData,
  initializeCleanDraftSession,
} from "../middleware/sessionCleanup";
import { cleanupOldDraftPreview } from "../middleware/messageCleanup";

export type DraftButton = { text: string; url?: string; callbackData?: string };

export class DraftManager {
  /**
   * Renders the draft preview with controls
   */
  static async renderDraftPreview(ctx: BotContext): Promise<void> {
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
    kb.text("Preview", "draft:preview").text("Clear", "draft:clear").row();

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

  /**
   * Processes text input for drafts
   */
  static async processTextInput(ctx: BotContext, text: string): Promise<void> {
    if (!ctx.session.draft) return;

    const msgId = ctx.message?.message_id;
    if (!msgId) return;

    const html = formatToHtml(text);
    if (!ctx.session.initialDraftMessageId) {
      ctx.session.initialDraftMessageId = msgId;
      ctx.session.draft.text = html;
    } else if (ctx.session.initialDraftMessageId === msgId) {
      return;
    } else {
      ctx.session.draft.text = ctx.session.draft.text
        ? ctx.session.draft.text + "\n" + html
        : html;
    }
    await this.renderDraftPreview(ctx);
  }

  /**
   * Processes edited text messages
   */
  static async processEditedText(ctx: BotContext, text: string): Promise<void> {
    if (
      !ctx.session.draft ||
      !ctx.session.initialDraftMessageId ||
      ctx.session.draftLocked
    )
      return;

    if (ctx.editedMessage?.message_id === ctx.session.initialDraftMessageId) {
      ctx.session.draft.text = formatToHtml(text);
      await this.renderDraftPreview(ctx);
    }
  }

  /**
   * Processes media input (photos/videos)
   */
  static async processMediaInput(
    ctx: BotContext,
    mediaType: "photo" | "video",
    fileId: string,
    caption?: string,
  ): Promise<void> {
    if (!ctx.session.draft || ctx.session.draftLocked) return;

    ctx.session.draft.postType = mediaType;
    ctx.session.draft.mediaFileId = fileId;
    if (caption) ctx.session.draft.text = caption;

    if (ctx.session.draftPreviewMessageId) {
      try {
        await ctx.api.deleteMessage(
          ctx.chat!.id,
          ctx.session.draftPreviewMessageId,
        );
      } catch {}
      delete ctx.session.draftPreviewMessageId;
    }
    await this.renderDraftPreview(ctx);
  }

  /**
   * Clears draft content
   */
  static clearDraft(ctx: BotContext): void {
    ctx.session.draft = { postType: "text", buttons: [] };
    delete ctx.session.draftPreviewMessageId;
    delete ctx.session.lastDraftTextMessageId;
    delete ctx.session.draftSourceMessages;
    delete ctx.session.initialDraftMessageId;
  }

  /**
   * Cancels draft completely
   */
  static cancelDraft(ctx: BotContext): void {
    clearAllDraftData(ctx);
  }

  /**
   * Initializes a new draft session
   */
  static initializeDraft(ctx: BotContext): void {
    initializeCleanDraftSession(ctx);
  }

  /**
   * Validates if draft has content
   */
  static validateDraftContent(ctx: BotContext): boolean {
    const draft = ctx.session.draft;
    return !!(draft && (draft.text?.trim() || draft.mediaFileId));
  }

  /**
   * Generates a fresh preview (cleanup old ones)
   */
  static async generateFreshPreview(ctx: BotContext): Promise<void> {
    delete ctx.session.draftPreviewMessageId;
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
    await this.renderDraftPreview(ctx);
  }
}
