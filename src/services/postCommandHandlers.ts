import type { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";
import { PostModel } from "../models/Post";
import { ChannelSelector } from "./channelSelector";
import { DraftManager } from "./draftManager";
import { ButtonManager } from "./buttonManager";
import { QueueManager } from "./queueManager";

export class PostCommandHandlers {
  /**
   * Handles /usechannel command
   */
  static async handleUseChannel(ctx: BotContext, chatIdText: string): Promise<void> {
    if (!chatIdText.trim()) {
      await ctx.reply("Usage: /usechannel <chatId>");
      return;
    }

    const chatId = Number(chatIdText.trim());
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
  }

  /**
   * Handles /newpost command
   */
  static async handleNewPost(ctx: BotContext): Promise<void> {
    await ChannelSelector.showChannelSelection(ctx);
  }

  /**
   * Handles /addbutton command
   */
  static async handleAddButton(ctx: BotContext): Promise<void> {
    if (!ctx.session.draft) {
      await ctx.reply("Start a draft first with /newpost");
      return;
    }
    await ButtonManager.showAddButtonInstructions(ctx);
  }

  /**
   * Handles /preview command
   */
  static async handlePreview(ctx: BotContext): Promise<void> {
    if (!ctx.session.draft) {
      await ctx.reply("No draft");
      return;
    }
    await DraftManager.generateFreshPreview(ctx);
  }

  /**
   * Handles /clear command
   */
  static async handleClear(ctx: BotContext): Promise<void> {
    DraftManager.clearDraft(ctx);
    await ctx.reply("Draft cleared.");
    await DraftManager.renderDraftPreview(ctx);
  }

  /**
   * Handles /cancel command
   */
  static async handleCancel(ctx: BotContext): Promise<void> {
    DraftManager.cancelDraft(ctx);
    await ctx.reply("Draft cancelled.");
  }

  /**
   * Handles /queue command
   */
  static async handleQueue(ctx: BotContext): Promise<void> {
    await QueueManager.showQueue(ctx);
  }

  /**
   * Handles /listposts command
   */
  static async handleListPosts(ctx: BotContext): Promise<void> {
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
  }
}
