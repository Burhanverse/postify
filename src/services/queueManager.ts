import { InlineKeyboard } from "grammy";
import type { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";
import { PostModel } from "../models/Post";
import { getUserChannels } from "../commands/channels";
import { postScheduler } from "./scheduler";
import { DateTime } from "luxon";
import { logger } from "../utils/logger";

export class QueueManager {
  /**
   * Handles queue channel selection
   */
  static async handleQueueChannelSelection(
    ctx: BotContext,
    chatId: string,
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Authentication required.");
      return;
    }

    const channels = await getUserChannels(userId);
    const selected = channels.find((c) => String(c.chatId) === chatId);
    if (!selected) {
      await ctx.reply("Channel not found or not linked.");
      return;
    }

    const channelId = selected._id.toString();
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

    const channelName =
      selected.title || selected.username || selected.chatId || "Unknown";
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

    // Build keyboard: New Post first, then Send Now/Cancel for each post, then Close
    const keyboard = new InlineKeyboard();
    keyboard.text("New Post", "new_post_quick").row();
    result.posts.forEach((post) => {
      keyboard
        .text("Send Now", `queue_sendnow:${post._id.toString()}`)
        .text("Cancel", `queue_cancel:${post._id.toString()}`)
        .row();
    });
    keyboard.text("Close", "close_message");

    await ctx.reply(response, {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
  }

  /**
   * Handles sending a scheduled post immediately
   */
  static async handleSendNow(ctx: BotContext, postId: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Authentication required.");
      return;
    }

    // Find the post and check ownership
    const post = await PostModel.findById(postId);
    if (!post) {
      await ctx.reply("Scheduled post not found.");
      return;
    }

    // Check if user owns the channel AND the channel belongs to current bot
    const channel = await ChannelModel.findOne({
      _id: post.channel,
      owners: userId,
      botId: ctx.me?.id, // Enforce current bot ownership
    });
    if (!channel) {
      await ctx.reply("You do not have permission to send this post from this bot.");
      return;
    }

    // Only allow if post is scheduled
    if (post.status !== "scheduled") {
      await ctx.reply("Post is not scheduled or already sent.");
      return;
    }

    // Publish immediately
    try {
      const { publishPost } = await import("./publisher");
      await publishPost(post);
      await ctx.reply("Posted successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Security-specific messaging for cross-bot binding
      if (msg.includes("bound to bot") || msg.includes("Refusing to publish")) {
        await ctx.reply(
          "This post is bound to a different personal bot. Please send it from the bot that created it, or recreate the post via the current personal bot.",
        );
        return;
      }
      await ctx.reply("Failed to send post: " + msg);
    }
  }

  /**
   * Handles cancelling a scheduled post
   */
  static async handleCancelScheduled(
    ctx: BotContext,
    postId: string,
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Authentication required.");
      return;
    }

    // Find the post and check ownership
    const post = await PostModel.findById(postId);
    if (!post) {
      await ctx.reply("Scheduled post not found.");
      return;
    }

    // Check if user owns the channel AND the channel belongs to current bot
    const channel = await ChannelModel.findOne({
      _id: post.channel,
      owners: userId,
      botId: ctx.me?.id, // Enforce current bot ownership
    });
    if (!channel) {
      await ctx.reply("You do not have permission to cancel this post from this bot.");
      return;
    }

    // Only allow if post is scheduled
    if (post.status !== "scheduled") {
      await ctx.reply("Post is not scheduled or already sent.");
      return;
    }

    // Remove the post
    await PostModel.deleteOne({ _id: postId });
    await ctx.reply("Cancelled scheduled post.");
  }

  /**
   * Shows queue for user's channels
   */
  static async showQueue(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Authentication required.");
      return;
    }

    try {
      // Get channels for this specific bot only
      const channels = await getUserChannels(userId, ctx.me?.id);

      if (!channels.length) {
        await ctx.reply(
          "**No channels found**\n\nUse /addchannel to link a channel first.",
          { parse_mode: "Markdown" },
        );
        return;
      }

      let channelId: string | undefined;
      if (channels.length === 1) {
        channelId = channels[0]._id.toString();
      } else {
        // Always prompt for selection if multiple channels
        const keyboard = new InlineKeyboard();
        channels.forEach((channel) => {
          const displayName =
            channel.title ||
            (channel.username
              ? `@${channel.username}`
              : `Channel ${channel.chatId}`);
          keyboard.text(displayName, `queue:select:${channel.chatId}`).row();
        });
        keyboard.text("Cancel", "queue:cancel");
        await ctx.reply("**Select a channel to view its queue:**", {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
        return;
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
      const channel = channels.find((c) => c._id.toString() === channelId);
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

      // Build keyboard: New Post first, then Send Now/Cancel for each post, then Close
      const keyboard = new InlineKeyboard();
      keyboard.text("New Post", "new_post_quick").row();
      result.posts.forEach((post) => {
        keyboard
          .text("Send Now", `queue_sendnow:${post._id.toString()}`)
          .text("Cancel", `queue_cancel:${post._id.toString()}`)
          .row();
      });
      keyboard.text("Close", "close_message");
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
  }
}
