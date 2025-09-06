import { InlineKeyboard } from "grammy";
import type { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";
import { getUserChannels } from "../commands/channels";
import { DraftManager } from "./draftManager";

export class ChannelSelector {
  /**
   * Shows channel selection for new post creation
   */
  static async showChannelSelection(ctx: BotContext): Promise<void> {
    // First, get user's channels for this specific bot context
    const userId = ctx.from?.id;
    const botId = ctx.me?.id;
    const channels = await getUserChannels(userId, botId);

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
      await this.selectChannelAndStartDraft(ctx, channel.chatId);
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
  }

  /**
   * Handles channel selection callback
   */
  static async handleChannelSelection(
    ctx: BotContext,
    chatId: string,
  ): Promise<void> {
    const chatIdNum = Number(chatId);
    const channel = await ChannelModel.findOne({
      chatId: chatIdNum,
      owners: ctx.from?.id,
      botId: ctx.me?.id, // Ensure channel belongs to this bot
    });

    if (!channel) {
      await ctx.editMessageText(
        "**Error:** Channel not found or access denied.\n\nPlease use /addchannel to link a valid channel.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    await this.selectChannelAndStartDraft(ctx, chatIdNum, true);
  }

  /**
   * Selects a channel and starts draft creation
   */
  static async selectChannelAndStartDraft(
    ctx: BotContext,
    chatId: number,
    isCallback: boolean = false,
  ): Promise<void> {
    const channel = await ChannelModel.findOne({
      chatId,
      owners: ctx.from?.id,
      botId: ctx.me?.id, // Ensure channel belongs to this bot
    });

    if (!channel) {
      const message =
        "**Error:** Channel not found or access denied.\n\nPlease use /addchannel to link a valid channel.";
      if (isCallback) {
        await ctx.editMessageText(message, { parse_mode: "Markdown" });
      } else {
        await ctx.reply(message, { parse_mode: "Markdown" });
      }
      return;
    }

    // Set selected channel and start draft
    ctx.session.selectedChannelChatId = chatId;
    DraftManager.initializeDraft(ctx);

    const draftStartMessage =
      `**Channel Selected:** ${channel.title || channel.username || chatId}\n\n` +
      "**Draft started!**\n\n" +
      "Send text to add to your draft. Use HTML tags for formatting:\n" +
      "• \`<b>bold</b>\` for **bold**\n" +
      "• \`<i>italic</i>\` for *italic*\n" +
      "• \`<code>code</code>\` for \`code\`\n" +
      "• \`<pre>code block</pre>\` for code blocks\n" +
      "• \`<blockquote>quote</blockquote>\` for quotes\n\n" +
      "Use buttons below to configure, then **Send Now** to post immediately or schedule for later:";

    if (isCallback) {
      await ctx.editMessageText(draftStartMessage, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(draftStartMessage, { parse_mode: "Markdown" });
    }

    await DraftManager.renderDraftPreview(ctx);
  }

  /**
   * Handles new post quick action from queue/other interfaces
   */
  static async handleNewPostQuick(ctx: BotContext): Promise<void> {
    // Clear any existing draft to start fresh
    DraftManager.initializeDraft(ctx);
    delete ctx.session.selectedChannelChatId;

    // Trigger new post flow - call the newpost command handler logic
    const channels = await getUserChannels(ctx.from?.id, ctx.me?.id);

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
  }

  /**
   * Handles new post cancellation
   */
  static async handleNewPostCancel(ctx: BotContext): Promise<void> {
    await ctx.editMessageText(
      "**Post creation cancelled.**\n\nUse /newpost to start a new post.",
      { parse_mode: "Markdown" },
    );
  }
}
