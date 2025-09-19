import type { BotContext } from "../telegram/bot";
import { QueueManager } from "./queueManager";
import { ChannelSelector } from "./channelSelector";
import { DraftManager } from "./draftManager";
import { ButtonManager } from "./buttonManager";
import { PostPublisher } from "./postPublisher";
import { handleScheduleCallback } from "../commands/scheduling";

export class CallbackHandler {
  /**
   * Main callback handler that routes to appropriate handlers
   */
  static async handleCallback(ctx: BotContext, data: string): Promise<boolean> {
    // Handle queue callbacks
    if (data.startsWith("queue_sendnow:")) {
      await ctx.answerCallbackQuery();
      const postId = data.split(":")[1];
      await QueueManager.handleSendNow(ctx, postId);
      return true;
    }

    if (data.startsWith("queue_cancel:")) {
      await ctx.answerCallbackQuery();
      const postId = data.split(":")[1];
      await QueueManager.handleCancelScheduled(ctx, postId);
      return true;
    }

    if (data.startsWith("queue:select:")) {
      await ctx.answerCallbackQuery();
      const chatId = data.split(":")[2];
      await QueueManager.handleQueueChannelSelection(ctx, chatId);
      return true;
    }

    // Handle new post callbacks
    if (data.startsWith("newpost:")) {
      const [, action, value] = data.split(":");

      if (action === "select") {
        await ctx.answerCallbackQuery();
        await ChannelSelector.handleChannelSelection(ctx, value);
        return true;
      }

      if (action === "cancel") {
        await ctx.answerCallbackQuery();
        await ChannelSelector.handleNewPostCancel(ctx);
        return true;
      }
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
      return true;
    }

    // Handle general action callbacks
    if (data === "new_post" || data === "new_post_quick") {
      await ctx.answerCallbackQuery();
      await ChannelSelector.handleNewPostQuick(ctx);
      return true;
    }

    if (data === "close_message") {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage();
      return true;
    }

    // Handle draft callbacks
    if (data.startsWith("draft:")) {
      return await this.handleDraftCallback(ctx, data);
    }

    return false;
  }

  /**
   * Handles draft-specific callbacks
   */
  private static async handleDraftCallback(
    ctx: BotContext,
    data: string,
  ): Promise<boolean> {
    if (!data.startsWith("draft:")) return false;

    if (!ctx.session.draft) {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "**No draft found**\n\nPlease start a new post with /newpost first.",
        { parse_mode: "Markdown" },
      );
      return true;
    }

    const [, action, value] = data.split(":");

    switch (action) {
      case "send":
        await ctx.answerCallbackQuery();
        await PostPublisher.showSendingOptions(ctx);
        return true;

      case "managebtns":
        await ctx.answerCallbackQuery();
        await ButtonManager.showButtonManagement(ctx);
        return true;

      case "addbtn":
        await ctx.answerCallbackQuery();
        await ButtonManager.showAddButtonInstructions(ctx);
        return true;

      case "showbtn":
        const idx = Number(value);
        await ctx.answerCallbackQuery();
        await ButtonManager.showButtonDetails(ctx, idx);
        return true;

      case "delbtn":
        const delIdx = Number(value);
        await ctx.answerCallbackQuery();
        await ButtonManager.removeButton(ctx, delIdx);
        return true;

      case "editbtn":
        const editIdx = Number(value);
        await ctx.answerCallbackQuery();
        await ButtonManager.startButtonEdit(ctx, editIdx);
        return true;

      case "back":
        await ctx.answerCallbackQuery();
        // Unlock draft editing when user returns
        delete ctx.session.draftLocked;
        await DraftManager.renderDraftPreview(ctx);
        return true;

      case "clear":
        DraftManager.clearDraft(ctx);
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Draft cleared**\n\nYour draft has been reset. You can start adding content again.",
          { parse_mode: "Markdown" },
        );
        await DraftManager.renderDraftPreview(ctx);
        return true;

      case "cancel":
        DraftManager.cancelDraft(ctx);
        await ctx.answerCallbackQuery();
        await ctx.reply(
          "**Draft cancelled**\n\nYour draft has been discarded. Use /newpost to start over.",
          { parse_mode: "Markdown" },
        );
        return true;

      case "schedule":
        await ctx.answerCallbackQuery();
        const { handleScheduleCommand } = await import(
          "../commands/scheduling"
        );
        await handleScheduleCommand(ctx);
        return true;

      case "schedulepin":
        await ctx.answerCallbackQuery();
        ctx.session.scheduleWithPin = true;
        const { handleScheduleCommand: handleScheduleCommandPin } =
          await import("../commands/scheduling");
        await handleScheduleCommandPin(ctx);
        return true;

      case "preview":
        delete ctx.session.draftPreviewMessageId;
        await ctx.answerCallbackQuery();
        if (ctx.session.draftLocked) {
          await ctx.reply(
            "Draft is locked while sending/scheduling menu is open.",
            { parse_mode: "Markdown" },
          );
          return true;
        }
        await DraftManager.generateFreshPreview(ctx);
        return true;

      case "sendnow":
        if (!DraftManager.validateDraftContent(ctx)) {
          await ctx.answerCallbackQuery();
          await ctx.reply(
            "**Draft is empty!**\n\nAdd text or media content first before sending.",
            { parse_mode: "Markdown" },
          );
          return true;
        }
        await PostPublisher.publishImmediate(ctx, false);
        return true;

      case "sendnowpin":
        if (!DraftManager.validateDraftContent(ctx)) {
          await ctx.answerCallbackQuery();
          await ctx.reply(
            "**Draft is empty!**\n\nAdd text or media content first before sending.",
            { parse_mode: "Markdown" },
          );
          return true;
        }
        await PostPublisher.publishImmediate(ctx, true);
        return true;

      default:
        return false;
    }
  }
}
