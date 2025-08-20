import { BotContext } from "../telegram/bot";
import { InlineKeyboard } from "grammy";
import { postScheduler } from "../services/scheduler";
import { ChannelModel } from "../models/Channel";
import { PostModel } from "../models/Post";
import { logger } from "../utils/logger";
import { DateTime } from "luxon";

/**
 * Enhanced schedule command handler with improved validation and user experience
 */
export async function handleScheduleCommand(ctx: BotContext, timeInput?: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Authentication required.");
    return;
  }

  // Validate draft exists
  if (!ctx.session.draft) {
    await ctx.reply("❌ **No draft found**\n\nCreate a draft first with /newpost", { parse_mode: "Markdown" });
    return;
  }

  // Validate draft has content
  if (!ctx.session.draft.text?.trim() && !ctx.session.draft.mediaFileId) {
    await ctx.reply("❌ **Draft is empty**\n\nAdd text or media content before scheduling.", { parse_mode: "Markdown" });
    return;
  }

  // Validate channel is selected
  if (!ctx.session.selectedChannelChatId) {
    await ctx.reply("❌ **No channel selected**\n\nUse /newpost to select a channel first.", { parse_mode: "Markdown" });
    return;
  }

  // Get user's timezone (defaulting to UTC for now)
  const timezone = 'UTC'; // TODO: Allow users to set their timezone

  // If no time input provided, show scheduling options
  if (!timeInput?.trim()) {
    await showSchedulingOptions(ctx);
    return;
  }

  // Parse the time input
  const parseResult = postScheduler.parseScheduleInput(timeInput, timezone);
  
  if (!parseResult.valid) {
    await ctx.reply(`❌ **Invalid time format**\n\n${parseResult.error}`, { parse_mode: "Markdown" });
    return;
  }

  const scheduledAt = parseResult.parsedDate!;

  try {
    // Find the channel
    const channel = await ChannelModel.findOne({
      chatId: ctx.session.selectedChannelChatId,
      owners: userId,
    });

    if (!channel) {
      await ctx.reply("❌ **Channel not found**\n\nPlease select a valid channel.", { parse_mode: "Markdown" });
      return;
    }

    // Check for scheduling conflicts
    const conflictCheck = await postScheduler.checkSchedulingConflicts(
      channel._id.toString(),
      scheduledAt
    );

    if (conflictCheck.hasConflict && conflictCheck.recommendation) {
      // Show warning but allow user to proceed
      const keyboard = new InlineKeyboard()
        .text("⚠️ Schedule Anyway", `schedule_confirm:${timeInput}`)
        .text("❌ Cancel", "schedule_cancel")
        .row()
        .text("📅 Choose Different Time", "schedule_options");

      await ctx.reply(
        `⚠️ **Scheduling Conflict Warning**\n\n${conflictCheck.recommendation}\n\n**Requested time:** ${scheduledAt.toFormat('MMM dd, yyyy \'at\' HH:mm')} ${timezone}\n\nWould you like to proceed anyway?`,
        { reply_markup: keyboard, parse_mode: "Markdown" }
      );
      return;
    }

    // Create the post
    const post = await PostModel.create({
      channel: channel._id,
      channelChatId: channel.chatId,
      authorTgId: userId,
      status: 'draft', // Will be updated to 'scheduled' by scheduler
      type: ctx.session.draft.postType || "text",
      text: ctx.session.draft.text,
      mediaFileId: ctx.session.draft.mediaFileId,
      buttons: ctx.session.draft.buttons,
    });

    // Schedule the post
    const scheduleResult = await postScheduler.schedulePost({
      postId: post._id.toString(),
      scheduledAt: scheduledAt.toJSDate(),
      timezone,
      channelId: channel._id.toString(),
      userId
    });

    if (!scheduleResult.success) {
      await ctx.reply(`❌ **Scheduling failed**\n\n${scheduleResult.error}`, { parse_mode: "Markdown" });
      return;
    }

    // Clear draft session
    delete ctx.session.draft;
    delete ctx.session.draftPreviewMessageId;
    delete ctx.session.lastDraftTextMessageId;
    delete ctx.session.draftSourceMessages;
    delete ctx.session.initialDraftMessageId;

    // Success message
    let successMessage = `✅ **Post scheduled successfully!**\n\n`;
    successMessage += `📅 **When:** ${scheduledAt.toFormat('MMMM dd, yyyy \'at\' HH:mm')} ${timezone}\n`;
    successMessage += `📺 **Channel:** ${channel.title || channel.username || channel.chatId}\n`;
    successMessage += `🆔 **Post ID:** \`${post._id.toString()}\``;

    if (scheduleResult.warning) {
      successMessage += `\n\n⚠️ **Note:** ${scheduleResult.warning}`;
    }

    const keyboard = new InlineKeyboard()
      .text("📋 View Queue", "view_queue")
      .text("📝 New Post", "new_post")
      .row()
      .text("❌ Cancel This Post", `cancel_post:${post._id.toString()}`);

    await ctx.reply(successMessage, { 
      reply_markup: keyboard, 
      parse_mode: "Markdown" 
    });

    logger.info({
      userId,
      postId: post._id.toString(),
      channelId: channel._id.toString(),
      scheduledAt: scheduledAt.toISO(),
      timezone
    }, "Post scheduled via enhanced handler");

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      userId,
      timeInput
    }, "Error in schedule command handler");

    await ctx.reply("❌ **Scheduling error**\n\nAn unexpected error occurred. Please try again.", { parse_mode: "Markdown" });
  }
}

/**
 * Show interactive scheduling options with enhanced quick-select buttons
 */
async function showSchedulingOptions(ctx: BotContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    // First row - Quick times
    .text("⏰ 15 min", "schedule_quick:in 15m")
    .text("⏰ 30 min", "schedule_quick:in 30m")
    .text("⏰ 1 hour", "schedule_quick:in 1h")
    .row()
    // Second row - Medium times
    .text("⏰ 2 hours", "schedule_quick:in 2h")
    .text("⏰ 4 hours", "schedule_quick:in 4h")
    .text("⏰ 6 hours", "schedule_quick:in 6h")
    .row()
    // Third row - Daily options
    .text("🌅 Tomorrow 8 AM", "schedule_quick:tomorrow 08:00")
    .text("🌆 Tomorrow 6 PM", "schedule_quick:tomorrow 18:00")
    .row()
    // Fourth row - This week
    .text("📅 Next Monday 9 AM", "schedule_quick:next monday 09:00")
    .text("📅 This Weekend", "schedule_quick:next saturday 10:00")
    .row()
    // Fifth row - Actions
    .text("🕐 Custom Time", "schedule_custom")
    .text("❌ Cancel", "schedule_cancel");

  await ctx.reply(
    "⏰ **When would you like to schedule this post?**\n\n" +
    "Choose a quick option below or set a custom time:\n\n" +
    "**Quick Options:**\n" +
    "• **15m - 6h:** Schedule for today\n" +
    "• **Tomorrow:** Schedule for next day\n" +
    "• **Next Week:** Schedule for upcoming days\n" +
    "• **Custom:** Enter your own time format",
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
}

/**
 * Handle schedule callback queries
 */
export async function handleScheduleCallback(ctx: BotContext, action: string, value: string): Promise<boolean> {
  if (!action.startsWith('schedule_')) return false;

  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery();
    await ctx.reply("❌ Authentication required.");
    return true;
  }

  switch (action) {
    case 'schedule_quick':
      await ctx.answerCallbackQuery();
      await handleScheduleCommand(ctx, value);
      break;

    case 'schedule_confirm':
      await ctx.answerCallbackQuery();
      await handleScheduleCommand(ctx, value);
      break;

    case 'schedule_cancel':
      await ctx.answerCallbackQuery();
      // Clear any pending scheduling input mode
      if (ctx.session.waitingForScheduleInput) {
        ctx.session.waitingForScheduleInput = false;
      }
      
      // Return to draft controls
      const cancelKeyboard = new InlineKeyboard()
        .text("📮 Send Now", "draft:sendnow")
        .text("⏰ Schedule", "draft:schedule")
        .row()
        .text("👁 Preview", "draft:preview")
        .text("✏️ Edit Text", "draft:edit_text")
        .row()
        .text("🔗 Add Button", "draft:add_button")
        .text("❌ Cancel Draft", "draft:cancel");
      
      await ctx.editMessageText(
        "❌ **Scheduling cancelled**\n\n" +
        "Your draft is still available. Use the buttons below to continue editing:",
        { 
          reply_markup: cancelKeyboard,
          parse_mode: "Markdown" 
        }
      );
      break;

    case 'schedule_options':
      await ctx.answerCallbackQuery();
      await showSchedulingOptions(ctx);
      break;

    case 'schedule_custom':
      await ctx.answerCallbackQuery();
      ctx.session.waitingForScheduleInput = true;
      
      const customKeyboard = new InlineKeyboard()
        .text("⏰ Back to Quick Options", "schedule_options")
        .text("❌ Cancel", "schedule_cancel");
      
      await ctx.editMessageText(
        "🕐 **Custom Scheduling**\n\n" +
        "Send your preferred time in one of these formats:\n\n" +
        "**⚡ Relative Time:**\n" +
        "• `in 15m` - In 15 minutes\n" +
        "• `in 2h` - In 2 hours\n" +
        "• `in 3d` - In 3 days\n\n" +
        "**📅 Absolute Time:**\n" +
        "• `14:30` - Today at 2:30 PM (or tomorrow if past)\n" +
        "• `tomorrow 09:00` - Tomorrow at 9:00 AM\n" +
        "• `2025-12-25 14:30` - Specific date and time\n" +
        "• `12/25/2025 14:30` - US date format\n\n" +
        "**📝 Natural Language:**\n" +
        "• `next monday 10:00` - Next Monday at 10 AM\n" +
        "• `friday 18:00` - This/next Friday at 6 PM\n\n" +
        "⏰ All times are in **UTC** timezone\n" +
        "⚠️ Minimum: 1 minute, Maximum: 6 months",
        { 
          reply_markup: customKeyboard,
          parse_mode: "Markdown" 
        }
      );
      break;

    case 'view_queue':
      await ctx.answerCallbackQuery();
      await showScheduledPosts(ctx);
      break;

    case 'new_post':
      await ctx.answerCallbackQuery();
      // Trigger new post command - this would need to be handled by the main command router
      await ctx.editMessageText("📝 Use /newpost to create a new post", { parse_mode: "Markdown" });
      break;

    default:
      if (action === 'cancel_post') {
        await handleCancelPost(ctx, value);
      }
      break;
  }

  return true;
}

/**
 * Show user's scheduled posts
 */
async function showScheduledPosts(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const result = await postScheduler.getScheduledPosts({
      userId,
      limit: 10
    });

    if (result.posts.length === 0) {
      await ctx.editMessageText(
        "📭 **No scheduled posts**\n\nYou don't have any posts scheduled at the moment.\n\nUse /newpost to create and schedule a new post.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let message = `📋 **Your scheduled posts** (${result.total} total)\n\n`;
    
    result.posts.forEach((post, index) => {
      const scheduledTime = DateTime.fromJSDate(post.scheduledAt!).toFormat('MMM dd, HH:mm');
      const preview = post.text ? 
        (post.text.length > 40 ? post.text.substring(0, 40) + "..." : post.text) : 
        "(Media post)";
      
      message += `${index + 1}. **${preview}**\n`;
      message += `   📅 ${scheduledTime} UTC\n`;
      const channelInfo = post.channel && typeof post.channel === 'object' && 'title' in post.channel
        ? (post.channel as { title?: string; username?: string }).title || 
          (post.channel as { title?: string; username?: string }).username || 
          'Unknown channel'
        : 'Unknown channel';
      
      message += `   📺 ${channelInfo}\n`;
      message += `   🆔 \`${post._id.toString()}\`\n\n`;
    });

    if (result.hasMore) {
      message += `_Showing first 10 posts. Use /queue for the full list._`;
    }

    const keyboard = new InlineKeyboard().text("❌ Close", "close_message");

    await ctx.editMessageText(message, { 
      reply_markup: keyboard, 
      parse_mode: "Markdown" 
    });

  } catch (error) {
    logger.error({ error, userId }, "Error showing scheduled posts");
    await ctx.editMessageText("❌ **Error loading scheduled posts**\n\nPlease try again later.", { parse_mode: "Markdown" });
  }
}

/**
 * Handle post cancellation
 */
async function handleCancelPost(ctx: BotContext, postId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.answerCallbackQuery();

  try {
    const result = await postScheduler.cancelScheduledPost(postId, userId);
    
    if (result.success) {
      await ctx.editMessageText(
        "✅ **Post cancelled successfully**\n\nThe scheduled post has been cancelled and moved back to drafts.",
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.editMessageText(
        `❌ **Cancellation failed**\n\n${result.error}`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (error) {
    logger.error({ error, userId, postId }, "Error cancelling post");
    await ctx.editMessageText("❌ **Error cancelling post**\n\nPlease try again later.", { parse_mode: "Markdown" });
  }
}
