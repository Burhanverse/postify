import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

const MAX_TRACKED_MESSAGES = 10; // Maximum number of bot messages to track for cleanup

export async function messageCleanupMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();

  // Initialize session tracking if not exists
  if (!ctx.session.recentBotMessages) {
    ctx.session.recentBotMessages = [];
  }
  if (!ctx.session.protectedMessages) {
    ctx.session.protectedMessages = {
      scheduleMessages: [],
      postSentNotices: [],
    };
  }

  // Clean up old bot messages before processing new command/message
  // Only cleanup on user-initiated actions (commands or messages)
  if (ctx.message || (ctx.callbackQuery && !isProtectedCallback(ctx))) {
    await cleanupOldMessages(ctx);
  }

  // Store original reply methods to intercept and track bot messages
  const originalReply = ctx.reply.bind(ctx);
  const originalReplyWithPhoto = ctx.replyWithPhoto?.bind(ctx);
  const originalReplyWithVideo = ctx.replyWithVideo?.bind(ctx);

  // Override reply methods to track sent messages and disable link previews
  ctx.reply = async (text: string, other?: Record<string, unknown>) => {
    const options = { 
      ...other, 
      disable_web_page_preview: true 
    } as Parameters<typeof originalReply>[1];
    const sent = await originalReply(text, options);
    trackBotMessage(ctx, sent.message_id, getMessageType(text, other));
    return sent;
  };

  if (ctx.replyWithPhoto) {
    ctx.replyWithPhoto = async (photo: string, other?: Record<string, unknown>) => {
      const options = { 
        ...other, 
        disable_web_page_preview: true 
      } as Parameters<typeof originalReplyWithPhoto>[1];
      const sent = await originalReplyWithPhoto!(photo, options);
      trackBotMessage(ctx, sent.message_id, "draft_preview");
      return sent;
    };
  }

  if (ctx.replyWithVideo) {
    ctx.replyWithVideo = async (video: string, other?: Record<string, unknown>) => {
      const options = { 
        ...other, 
        disable_web_page_preview: true 
      } as Parameters<typeof originalReplyWithVideo>[1];
      const sent = await originalReplyWithVideo!(video, options);
      trackBotMessage(ctx, sent.message_id, "draft_preview");
      return sent;
    };
  }

  await next();
}

function isProtectedCallback(ctx: BotContext): boolean {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  // Protect scheduling-related callbacks
  if (data.startsWith("schedule_") || data.includes("queue")) return true;
  
  // Protect draft preview callbacks (don't cleanup when user interacts with draft)
  if (data.startsWith("draft:") && !data.includes("preview")) return true;
  
  return false;
}

function getMessageType(text: string, other?: Record<string, unknown>): "schedule" | "post_sent" | "draft_preview" | "general" {
  if (text.includes("scheduled successfully") || text.includes("Schedule")) {
    return "schedule";
  }
  if (text.includes("Post sent successfully") || text.includes("published to")) {
    return "post_sent";
  }
  if (other?.reply_markup && (text.includes("(empty)") || text.includes("📝") || text.includes("📤"))) {
    return "draft_preview";
  }
  return "general";
}

function trackBotMessage(ctx: BotContext, messageId: number, type: "schedule" | "post_sent" | "draft_preview" | "general") {
  if (!ctx.session.recentBotMessages) ctx.session.recentBotMessages = [];
  if (!ctx.session.protectedMessages) ctx.session.protectedMessages = {};

  // Add to appropriate tracking array
  switch (type) {
    case "schedule":
      if (!ctx.session.protectedMessages.scheduleMessages) {
        ctx.session.protectedMessages.scheduleMessages = [];
      }
      ctx.session.protectedMessages.scheduleMessages.push(messageId);
      // Keep only last 3 schedule messages
      if (ctx.session.protectedMessages.scheduleMessages.length > 3) {
        ctx.session.protectedMessages.scheduleMessages.shift();
      }
      break;
    
    case "post_sent":
      if (!ctx.session.protectedMessages.postSentNotices) {
        ctx.session.protectedMessages.postSentNotices = [];
      }
      ctx.session.protectedMessages.postSentNotices.push(messageId);
      // Keep only last 2 post sent notices
      if (ctx.session.protectedMessages.postSentNotices.length > 2) {
        ctx.session.protectedMessages.postSentNotices.shift();
      }
      break;
    
    case "draft_preview":
      // Update current draft preview (only keep one active)
      ctx.session.protectedMessages.currentDraftPreview = messageId;
      break;
    
    default:
      // Track general messages for cleanup
      ctx.session.recentBotMessages.push(messageId);
      // Keep only recent messages
      if (ctx.session.recentBotMessages.length > MAX_TRACKED_MESSAGES) {
        ctx.session.recentBotMessages.shift();
      }
  }
}

async function cleanupOldMessages(ctx: BotContext) {
  const chatId = ctx.chat!.id;
  const messagesToClean = [...(ctx.session.recentBotMessages || [])];
  
  // Get all protected message IDs
  const protectedIds = new Set([
    ...(ctx.session.protectedMessages?.scheduleMessages || []),
    ...(ctx.session.protectedMessages?.postSentNotices || []),
  ]);
  
  if (ctx.session.protectedMessages?.currentDraftPreview) {
    protectedIds.add(ctx.session.protectedMessages.currentDraftPreview);
  }

  // Clean up messages that are not protected
  const toDelete = messagesToClean.filter(id => !protectedIds.has(id));
  
  for (const messageId of toDelete) {
    try {
      await ctx.api.deleteMessage(chatId, messageId);
    } catch (error) {
      // Ignore errors (message might already be deleted or too old)
      logger.debug({ error, messageId, chatId }, "Failed to delete message");
    }
  }

  // Clear cleaned up messages from tracking
  if (ctx.session.recentBotMessages) {
    ctx.session.recentBotMessages = ctx.session.recentBotMessages.filter(id => protectedIds.has(id));
  }
}

// Function to manually cleanup draft preview when user generates new one
export async function cleanupOldDraftPreview(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const oldPreviewId = ctx.session.protectedMessages?.currentDraftPreview;
  if (oldPreviewId) {
    try {
      await ctx.api.deleteMessage(chatId, oldPreviewId);
    } catch (error) {
      logger.debug({ error, messageId: oldPreviewId }, "Failed to delete old draft preview");
    }
    // Clear the old preview reference
    if (ctx.session.protectedMessages) {
      ctx.session.protectedMessages.currentDraftPreview = undefined;
    }
  }
}
