import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

export async function loggingMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  const startTime = Date.now();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const updateType = getUpdateType(ctx);
  const action = getActionInfo(ctx);

  // Log incoming request
  logger.info({
    userId,
    chatId,
    updateType,
    action,
    messageId: ctx.message?.message_id,
    callbackId: ctx.callbackQuery?.id
  }, "Processing update");

  try {
    await next();
    
    const duration = Date.now() - startTime;
    
    // Log successful completion
    logger.info({
      userId,
      chatId,
      updateType,
      action,
      duration
    }, "Update processed successfully");
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Log error (but don't handle it - let error middleware handle)
    logger.error({
      userId,
      chatId,
      updateType,
      action,
      duration,
      error: error instanceof Error ? error.message : String(error)
    }, "Update processing failed");
    
    throw error; // Re-throw for error middleware
  }
}

function getUpdateType(ctx: BotContext): string {
  if (ctx.message) {
    if (ctx.message.text?.startsWith('/')) return 'command';
    if (ctx.message.text) return 'text';
    if (ctx.message.photo) return 'photo';
    if (ctx.message.video) return 'video';
    return 'message';
  }
  
  if (ctx.callbackQuery) return 'callback';
  if (ctx.editedMessage) return 'edited_message';
  if (ctx.channelPost) return 'channel_post';
  
  return 'unknown';
}

function getActionInfo(ctx: BotContext): string {
  if (ctx.message?.text?.startsWith('/')) {
    return ctx.message.text.split(' ')[0];
  }
  
  if (ctx.callbackQuery?.data) {
    return `callback:${ctx.callbackQuery.data}`;
  }
  
  if (ctx.message?.text) {
    // For draft mode detection
    if (ctx.session && ctx.session.draftEditMode) {
      return `draft_input:${ctx.session.draftEditMode}`;
    }
    return 'text_input';
  }
  
  if (ctx.message?.photo) return 'photo_upload';
  if (ctx.message?.video) return 'video_upload';
  
  return 'unknown_action';
}

export function logUserActivity(
  userId: number,
  action: string,
  details?: Record<string, unknown>
) {
  logger.info({
    userId,
    action,
    ...details,
    timestamp: new Date().toISOString()
  }, "User activity");
}

export function logSystemEvent(
  event: string,
  details?: Record<string, unknown>
) {
  logger.info({
    event,
    ...details,
    timestamp: new Date().toISOString()
  }, "System event");
}
