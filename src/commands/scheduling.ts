import { BotContext } from "../telegram/bot";
import { InlineKeyboard } from "grammy";
import { postScheduler } from "../services/scheduler";
import { ChannelModel } from "../models/Channel";
import { PostModel } from "../models/Post";
import { UserModel, User } from "../models/User";
import { logger } from "../utils/logger";
import { DateTime } from "luxon";
async function upsertScheduleMessage(
  ctx: BotContext,
  text: string,
  keyboard?: InlineKeyboard,
) {
  const id = ctx.session.scheduleMessageId;
  if (id) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, id, text, {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
      return id;
    } catch {}
  }
  const sent = await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
  ctx.session.scheduleMessageId = sent.message_id;
  return sent.message_id;
}

/**
 * Enhanced schedule command handler with improved validation and user experience
 */
export async function handleScheduleCommand(
  ctx: BotContext,
  timeInput?: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("Authentication required.");
    return;
  }

  // Validate draft exists (draftLocked still counts as existing; it's just frozen for edits)
  if (!ctx.session.draft) {
    await ctx.reply(
      "**No draft found**\n\nCreate a draft first with /newpost",
      { parse_mode: "Markdown" },
    );
    return;
  }

  // Validate draft has content
  if (!ctx.session.draft.text?.trim() && !ctx.session.draft.mediaFileId) {
    await ctx.reply(
      "**Draft is empty**\n\nAdd text or media content before scheduling.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  // Validate channel is selected
  if (!ctx.session.selectedChannelChatId) {
    await ctx.reply(
      "**No channel selected**\n\nUse /newpost to select a channel first.",
      { parse_mode: "Markdown" },
    );
    return;
  }

  // Get user's timezone (persisted preference or fallback)
  const user = await UserModel.findOne({ tgId: userId });
  const timezone =
    (user as User & { preferences?: { timezone?: string } })?.preferences
      ?.timezone || "UTC";

  // If no time input provided, show scheduling options
  if (!timeInput?.trim()) {
    await showSchedulingOptions(ctx);
    return;
  }

  // Parse the time input
  const parseResult = postScheduler.parseScheduleInput(timeInput, timezone);

  if (!parseResult.valid) {
    await ctx.reply(`**Invalid time format**\n\n${parseResult.error}`, {
      parse_mode: "Markdown",
    });
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
      await ctx.reply(
        "**Channel not found**\n\nPlease select a valid channel.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Check for scheduling conflicts
    const conflictCheck = await postScheduler.checkSchedulingConflicts(
      channel._id.toString(),
      scheduledAt,
    );

    if (conflictCheck.hasConflict && conflictCheck.recommendation) {
      // Show warning but allow user to proceed
      const keyboard = new InlineKeyboard()
        .text("Schedule Anyway", `schedule_confirm:${timeInput}`)
        .text("Cancel", "schedule_cancel")
        .row()
        .text("Choose Different Time", "schedule_options");

      await ctx.reply(
        `**Scheduling Conflict Warning**\n\n${conflictCheck.recommendation}\n\n**Requested time:** ${scheduledAt.toFormat("MMM dd, yyyy 'at' HH:mm")} ${timezone}\n\nWould you like to proceed anyway?`,
        { reply_markup: keyboard, parse_mode: "Markdown" },
      );
      return;
    }

    // Create the post
    const post = await PostModel.create({
      channel: channel._id,
      channelChatId: channel.chatId,
      authorTgId: userId,
      status: "draft", // Will be updated to 'scheduled' by scheduler
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
      userId,
    });

    if (!scheduleResult.success) {
      await ctx.reply(`**Scheduling failed**\n\n${scheduleResult.error}`, {
        parse_mode: "Markdown",
      });
      return;
    }

    // Clear draft session
    delete ctx.session.draft;
    delete ctx.session.draftPreviewMessageId;
    delete ctx.session.lastDraftTextMessageId;
    delete ctx.session.draftSourceMessages;
    delete ctx.session.initialDraftMessageId;
    delete ctx.session.draftLocked;

    // Success message
    let successMessage = `**Post scheduled successfully!**\n\n`;
    successMessage += `**When:** ${scheduledAt.toFormat("MMMM dd, yyyy 'at' HH:mm")} ${timezone}\n`;
    successMessage += `**Channel:** ${channel.title || channel.username || channel.chatId}\n`;
    successMessage += `**Post ID:** \`${post._id.toString()}\``;

    if (scheduleResult.warning) {
      successMessage += `\n\n**Note:** ${scheduleResult.warning}`;
    }

    const keyboard = new InlineKeyboard()
      .text(" New Post", "new_post")
      .row()
      .text("Cancel This Post", `cancel_post:${post._id.toString()}`);

    await ctx.reply(successMessage, {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });

    logger.info(
      {
        userId,
        postId: post._id.toString(),
        channelId: channel._id.toString(),
        scheduledAt: scheduledAt.toISO(),
        timezone,
      },
      "Post scheduled via enhanced handler",
    );
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        userId,
        timeInput,
      },
      "Error in schedule command handler",
    );

    await ctx.reply(
      "**Scheduling error**\n\nAn unexpected error occurred. Please try again.",
      { parse_mode: "Markdown" },
    );
  }
}

/**
 * Show interactive scheduling options with enhanced quick-select buttons
 */
async function showSchedulingOptions(ctx: BotContext): Promise<void> {
  const userDoc = await UserModel.findOne({ tgId: ctx.from?.id });
  const userTz =
    (userDoc as (User & { preferences?: { timezone?: string } }) | null)
      ?.preferences?.timezone || "UTC";
  const keyboard = new InlineKeyboard()
    // Preset row 1
    .text("15m", "schedule_quick:in 15m")
    .text("30m", "schedule_quick:in 30m")
    .text("1h", "schedule_quick:in 1h")
    .row()
    // Preset row 2
    .text("2h", "schedule_quick:in 2h")
    .text("4h", "schedule_quick:in 4h")
    .text("6h", "schedule_quick:in 6h")
    .row()
    // Day based
    .text("Tomorrow 09:00", "schedule_quick:tomorrow 09:00")
    .text("Tomorrow 18:00", "schedule_quick:tomorrow 18:00")
    .row()
    .text("Next Mon 09:00", "schedule_quick:next monday 09:00")
    .text("Weekend 10:00", "schedule_quick:next saturday 10:00")
    .row()
    // submenu actions
    .text("Custom", "schedule_custom")
    .text("TZ: " + userTz, "schedule_tz_menu")
    .row()
    .text("Cancel", "schedule_cancel");

  const text = `**Schedule Post**\n\nCurrent Timezone: **${userTz}**\nSelect a preset below or choose Custom / Timezone.`;
  await upsertScheduleMessage(ctx, text, keyboard);
}

// Timezone selection submenu (paged minimal list of common timezones)
function timezoneKeyboard(page = 0): InlineKeyboard {
  // Prefer runtime-provided list of IANA time zones when available (Node 18+)
  // This lets us show the full set of regions without hardcoding hundreds of entries.
  const fallback = [
    "UTC",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Moscow",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Sao_Paulo",
  ];

  // Type-safe check for Intl.supportedValuesOf
  type IntlWithSupported = typeof Intl & {
    supportedValuesOf?: (type: string) => string[];
  };
  const allTzs: string[] =
    typeof Intl !== "undefined" && (Intl as IntlWithSupported).supportedValuesOf
      ? (Intl as IntlWithSupported).supportedValuesOf!("timeZone")
      : fallback;

  // Ensure deterministic unique entries, then sort by display label (after last '/')
  const unique = Array.from(new Set(allTzs));
  const labeled = unique.map((tz) => ({ tz, label: tz.includes("/") ? tz.split("/").pop()! : tz }));
  labeled.sort((a, b) => a.label.localeCompare(b.label));

  const perPage = 12;
  const start = page * perPage;
  const slice = labeled.slice(start, start + perPage);
  const kb = new InlineKeyboard();
  slice.forEach((entry) => kb.text(entry.label, `schedule_tz_set:${entry.tz}`).row());
  const total = unique.length;
  if (total > perPage) {
    const maxPage = Math.floor((total - 1) / perPage);
    kb.text(page > 0 ? "Prev" : "·", `schedule_tz_page:${Math.max(page - 1, 0)}`)
      .text("Cancel", "schedule_cancel")
      .text(page < maxPage ? "Next" : "·", `schedule_tz_page:${Math.min(page + 1, maxPage)}`)
      .row();
  } else {
    kb.text("Cancel", "schedule_cancel").row();
  }
  kb.text("Back", "schedule_options");
  return kb;
}

/**
 * Handle schedule callback queries
 */
export async function handleScheduleCallback(
  ctx: BotContext,
  action: string,
  value: string,
): Promise<boolean> {
  const allowed = ["new_post", "cancel_post"];
  if (!action.startsWith("schedule_") && !allowed.includes(action))
    return false;

  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery();
    await ctx.reply("Authentication required.");
    return true;
  }

  switch (action) {
    case "schedule_quick": {
      await ctx.answerCallbackQuery();
      await UserModel.findOneAndUpdate(
        { tgId: userId },
        { $set: { "preferences.lastSchedulePreset": value } },
      );
      await handleScheduleCommand(ctx, value);
      break;
    }

    case "schedule_confirm":
      await ctx.answerCallbackQuery();
      await handleScheduleCommand(ctx, value);
      break;

    case "schedule_cancel":
      await ctx.answerCallbackQuery();
      if (ctx.session.waitingForScheduleInput) {
        ctx.session.waitingForScheduleInput = false;
      }

      // Return to draft controls
      const cancelKeyboard = new InlineKeyboard()
        .text("Send Now", "draft:sendnow")
        .text("Schedule", "draft:schedule")
        .row()
        .text("Preview", "draft:preview")
        .text("Edit Text", "draft:edit_text")
        .row()
        .text("Add Button", "draft:add_button")
        .text("Cancel Draft", "draft:cancel");

      await ctx.editMessageText(
        "**Scheduling cancelled**\n\n" +
          "Your draft is still available. Use the buttons below to continue editing:",
        {
          reply_markup: cancelKeyboard,
          parse_mode: "Markdown",
        },
      );
      break;

    case "schedule_options":
      await ctx.answerCallbackQuery();
      await showSchedulingOptions(ctx);
      break;

    case "schedule_custom": {
      await ctx.answerCallbackQuery();
      ctx.session.waitingForScheduleInput = true;
      const user = await UserModel.findOne({ tgId: userId });
      const tz =
        (user as User & { preferences?: { timezone?: string } })?.preferences
          ?.timezone || "UTC";
      const customKeyboard = new InlineKeyboard()
        .text("Presets", "schedule_options")
        .text("Cancel", "schedule_cancel")
        .row()
        .text("Timezone", "schedule_tz_menu");
      const customText = `**Custom Time**\n\nCurrent Timezone: **${tz}**\n\nSend a time (examples):\n• in 15m / in 2h / in 3d\n• 14:30 (today or tomorrow)\n• tomorrow 09:00\n• 2025-12-25 14:30\n• next monday 10:00\n\nMinimum 1 minute, Maximum 6 months.`;
      await upsertScheduleMessage(ctx, customText, customKeyboard);
      break;
    }

    case "schedule_tz_menu": {
      await ctx.answerCallbackQuery();
      const tzText =
        "**Select Timezone**\n\nChoose one of the common timezones below. More will be added later.";
      await upsertScheduleMessage(ctx, tzText, timezoneKeyboard(0));
      break;
    }

    case "schedule_tz_page": {
      await ctx.answerCallbackQuery();
      const pageNum = parseInt(value || "0") || 0;
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: timezoneKeyboard(pageNum),
        });
      } catch {}
      break;
    }

    case "schedule_tz_set": {
      await ctx.answerCallbackQuery({ text: "Timezone updated" });
      if (value) {
        await UserModel.findOneAndUpdate(
          { tgId: userId },
          { $set: { "preferences.timezone": value } },
        );
      }
      if (ctx.session.waitingForScheduleInput) {
        const customKeyboard = new InlineKeyboard()
          .text("Presets", "schedule_options")
          .text("Cancel", "schedule_cancel")
          .row()
          .text("Timezone", "schedule_tz_menu");
        const backText = `**Custom Time**\n\nUpdated Timezone: **${value}**\n\nEnter your desired time.`;
        await upsertScheduleMessage(ctx, backText, customKeyboard);
      } else {
        await showSchedulingOptions(ctx);
      }
      break;
    }

    case "view_queue":
      await ctx.answerCallbackQuery();
      await showScheduledPosts(ctx);
      break;

    case "new_post":
      await ctx.answerCallbackQuery();
      // Trigger new post command - this would need to be handled by the main command router
      await ctx.editMessageText("Use /newpost to create a new post", {
        parse_mode: "Markdown",
      });
      break;

    default:
      if (action === "cancel_post") {
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
      limit: 10,
    });

    if (result.posts.length === 0) {
      await ctx.editMessageText(
        "**No scheduled posts**\n\nYou don't have any posts scheduled at the moment.\n\nUse /newpost to create and schedule a new post.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    let message = `**Your scheduled posts** (${result.total} total)\n\n`;

    result.posts.forEach((post, index) => {
      const scheduledTime = DateTime.fromJSDate(post.scheduledAt!).toFormat(
        "MMM dd, HH:mm",
      );
      const preview = post.text
        ? post.text.length > 40
          ? post.text.substring(0, 40) + "..."
          : post.text
        : "(Media post)";

      message += `${index + 1}. **${preview}**\n`;
      message += `   ${scheduledTime} UTC\n`;
      const channelInfo =
        post.channel &&
        typeof post.channel === "object" &&
        "title" in post.channel
          ? (post.channel as { title?: string; username?: string }).title ||
            (post.channel as { title?: string; username?: string }).username ||
            "Unknown channel"
          : "Unknown channel";

      message += `   ${channelInfo}\n`;
      message += `   ID: \`${post._id.toString()}\`\n\n`;
    });

    if (result.hasMore) {
      message += `_Showing first 10 posts. Use /queue for the full list._\n\n`;
    }

    const keyboard = new InlineKeyboard().text("Close", "close_message");

    await ctx.editMessageText(message, {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
  } catch (error) {
    logger.error({ error, userId }, "Error showing scheduled posts");
    await ctx.editMessageText(
      "**Error loading scheduled posts**\n\nPlease try again later.",
      { parse_mode: "Markdown" },
    );
  }
}

/**
 * Handle post cancellation
 */
async function handleCancelPost(
  ctx: BotContext,
  postId: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.answerCallbackQuery();

  try {
    const result = await postScheduler.cancelScheduledPost(postId, userId);

    if (result.success) {
      await ctx.editMessageText(
        "**Post cancelled successfully**\n\nThe scheduled post has been cancelled and moved back to drafts.",
        { parse_mode: "Markdown" },
      );
    } else {
      await ctx.editMessageText(
        `**Cancellation failed**\n\n${result.error}`,
        { parse_mode: "Markdown" },
      );
    }
  } catch (error) {
    logger.error({ error, userId, postId }, "Error cancelling post");
    await ctx.editMessageText(
      "**Error cancelling post**\n\nPlease try again later.",
      { parse_mode: "Markdown" },
    );
  }
}
