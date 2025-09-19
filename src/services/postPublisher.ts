import { InlineKeyboard } from "grammy";
import type { BotContext } from "../telegram/bot";
import { ChannelModel, type ChannelDoc } from "../models/Channel";
import { PostModel, type Post } from "../models/Post";
import { Types } from "mongoose";
import { clearAllDraftData } from "../middleware/sessionCleanup";

interface DraftData {
  postType?: "text" | "photo" | "video" | "gif";
  text?: string;
  mediaFileId?: string;
  buttons?: Array<{ text: string; url?: string; callbackData?: string }>;
}

export class PostPublisher {
  static async validatePostSending(
    ctx: BotContext,
  ): Promise<{ success: boolean; channel?: ChannelDoc; error?: string }> {
    const draft = ctx.session.draft;
    if (!draft || (!draft.text?.trim() && !draft.mediaFileId)) {
      return {
        success: false,
        error:
          "**Draft is empty!**\n\nAdd text or media content first before sending.",
      };
    }

    // Check if channel is selected
    if (!ctx.session.selectedChannelChatId) {
      return {
        success: false,
        error:
          "**No channel selected!**\n\nUse /newpost to select a channel first.",
      };
    }

    const channel = await ChannelModel.findOne({
      chatId: ctx.session.selectedChannelChatId,
      owners: ctx.from?.id,
      botId: ctx.me?.id, // Enforce current bot owns this channel
    });

  if (!channel) {
      return {
        success: false,
        error:
          "**Channel not found or not linked to this bot!**\n\nPlease use /newpost to select a channel that belongs to this personal bot.",
      };
    }

  if (!channel.botId) {
      return {
        success: false,
        error:
          "**Channel missing personal bot link**\n\nRelink this channel via your *personal bot* using /addchannel inside that bot chat.",
      };
    }

    const { UserBotModel } = await import("../models/UserBot");
    const userBotRecord = await UserBotModel.findOne({
      botId: channel.botId,
      status: "active",
    });

  if (!userBotRecord) {
      // Check if there's a bot record with different status
      const anyBotRecord = await UserBotModel.findOne({ botId: channel.botId });
      if (anyBotRecord) {
        return {
          success: false,
          error: `**Personal bot has issues**\n\nThe bot linked to this channel has status: "${anyBotRecord.status}". Please use /mybot to check your bot status and fix any issues, or relink this channel to your active personal bot.`,
        };
      } else {
        return {
          success: false,
          error:
            "**Personal bot not found**\n\nThe bot linked to this channel is no longer registered. Please relink this channel to your active personal bot using /addchannel.",
        };
      }
    }

    // Check if bot instance is available in registry (even if still starting up)
    const { getExistingUserBot } = await import("./userBotRegistry");
    const botInstance = getExistingUserBot(channel.botId);

    if (!botInstance) {
      return {
        success: false,
        error:
          "**Personal bot not loaded**\n\nYour personal bot is registered but not loaded in memory. Try restarting the main application or use /mybot to check status.",
      };
    }

    // Security: if this is a media post, enforce that media was created via the same personal bot
    const draftForSecurity = ctx.session.draft;
    if (
      draftForSecurity?.mediaFileId &&
      (draftForSecurity.postType === "photo" || draftForSecurity.postType === "video" || draftForSecurity.postType === "gif") &&
      ctx.me?.id !== channel.botId
    ) {
      return {
        success: false,
        error:
          "**Media must be created via your personal bot**\n\nThis post contains media. For security and reliability, upload media using your personal bot for this channel, then send or schedule from there.",
      };
    }

    return { success: true, channel };
  }

  /**
   * Publishes a post immediately
   */
  static async publishImmediate(
    ctx: BotContext,
    pinAfterPosting: boolean = false,
  ): Promise<void> {
    const validation = await this.validatePostSending(ctx);
    if (!validation.success || !validation.channel) {
      await ctx.reply(validation.error!, { parse_mode: "Markdown" });
      return;
    }

    const channel = validation.channel;
    const draft = ctx.session.draft!;

    try {
      const feedbackText = pinAfterPosting ? "Sending & pinning…" : "Sending…";
      await ctx.answerCallbackQuery({ text: feedbackText });
    } catch {}

    try {
      const post = await PostModel.create({
        channel: channel._id,
        channelChatId: channel.chatId,
        authorTgId: ctx.from?.id,
        status: "draft",
        type: draft.postType || "text",
        text: draft.text?.trim() || undefined,
        mediaFileId: draft.mediaFileId || undefined,
  // When drafting via main bot, media is captured by main bot; store its id for cross-bot handling
  mediaOwnerBotId: ctx.me?.id,
  // Lock publisher bot to the channel's current personal bot
  publisherBotId: channel.botId,
        buttons: draft.buttons || [],
        pinAfterPosting,
      });

      console.log(
        `Created post${pinAfterPosting ? " with pin flag" : ""}:`,
        post._id.toString(),
      );

      const { publishPost } = await import("./publisher");
      await publishPost(post as Post & { _id: Types.ObjectId });

      console.log(
        `Published${pinAfterPosting ? " and pinned" : ""} post successfully`,
      );

      clearAllDraftData(ctx);

      const successMessage = pinAfterPosting
        ? `**Post sent & pinned successfully!**\n\nYour post has been published and pinned to: ${channel.title || channel.username || channel.chatId}`
        : `**Post sent successfully!**\n\nYour post has been published to: ${channel.title || channel.username || channel.chatId}`;

      await this.sendSuccessMessage(ctx, successMessage, draft);
    } catch (error) {
      console.error(`Send now${pinAfterPosting ? " & pin" : ""} error:`, error);
      try {
        await ctx.answerCallbackQuery();
      } catch {}
      delete ctx.session.draftLocked;

      await this.handlePublishError(ctx, error, draft, pinAfterPosting);
    }
  }

  /**
   * Sends success message after publishing
   */
  private static async sendSuccessMessage(
    ctx: BotContext,
    message: string,
    draft: DraftData,
  ): Promise<void> {
    try {
      if (
        draft.mediaFileId &&
        (draft.postType === "photo" || draft.postType === "video" || draft.postType === "gif")
      ) {
        await ctx.reply(message, { parse_mode: "Markdown" });
      } else {
        try {
          await ctx.editMessageText(message, { parse_mode: "Markdown" });
        } catch {
          await ctx.reply(message, { parse_mode: "Markdown" });
        }
      }
    } catch {
      await ctx.reply(message, { parse_mode: "Markdown" });
    }
  }

  /**
   * Handles publish errors with appropriate user messaging
   */
  private static async handlePublishError(
    ctx: BotContext,
    error: unknown,
    draft: DraftData,
    pinning: boolean = false,
  ): Promise<void> {
    const sendErrorMessage = async (message: string) => {
      try {
        if (
          draft.mediaFileId &&
          (draft.postType === "photo" || draft.postType === "video" || draft.postType === "gif")
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
        const rights = pinning
          ? "posting and pinning rights"
          : "posting rights";
        await sendErrorMessage(
          `**Error: Insufficient permissions**\n\nPersonal bot lacks permission to ${pinning ? "post or pin" : "post"}. Make sure your personal bot is still an admin with ${rights}.`,
        );
      } else if (
        error.message.includes("personal bot") ||
        error.message.includes("Personal bot inactive")
      ) {
        await sendErrorMessage(
          "**Personal bot issue**\n\nVerify your personal bot is running (/mybot) and relink the channel via that bot /addchannel.",
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

  /**
   * Shows sending options (immediate or schedule)
   */
  static async showSendingOptions(ctx: BotContext): Promise<void> {
    ctx.session.draftLocked = true;
    const kb = new InlineKeyboard()
      .text("Send Now", "draft:sendnow")
      .text("Send Now & Pin", "draft:sendnowpin")
      .row()
      .text("Schedule", "draft:schedule")
      .text("Schedule & Pin", "draft:schedulepin")
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
  }
}
