import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

export async function sessionCleanupMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  try {
    await next();
  } finally {
    // Clean up after request processing
    await cleanupSession(ctx);
  }
}

async function cleanupSession(ctx: BotContext) {
  try {
    // Clean up expired draft mode states
    if (ctx.session.draftEditMode && !ctx.session.draft) {
      delete ctx.session.draftEditMode;
      logger.debug({ userId: ctx.from?.id }, "Cleaned up orphaned draft edit mode");
    }

    // Clean up orphaned preview message references
    if (ctx.session.draftPreviewMessageId && !ctx.session.draft) {
      delete ctx.session.draftPreviewMessageId;
      delete ctx.session.lastDraftTextMessageId;
      delete ctx.session.draftSourceMessages;
      delete ctx.session.initialDraftMessageId;
      logger.debug({ userId: ctx.from?.id }, "Cleaned up orphaned draft preview references");
    }

    // Clean up temporary states
    cleanupTemporaryStates(ctx);

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      userId: ctx.from?.id
    }, "Session cleanup error");
  }
}

function cleanupTemporaryStates(ctx: BotContext) {
  // List of temporary session keys that should be cleaned up after certain operations
  const temporaryKeys = [
    'awaitingChannelRef',
    'tempMessageId',
    'lastErrorTime'
  ];

  let cleanedCount = 0;
  for (const key of temporaryKeys) {
    if (key in ctx.session) {
      delete (ctx.session as Record<string, unknown>)[key];
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug({ 
      userId: ctx.from?.id, 
      cleanedKeys: cleanedCount 
    }, "Cleaned up temporary session states");
  }
}

export function clearDraftSession(ctx: BotContext) {
  delete ctx.session.draft;
  delete ctx.session.draftPreviewMessageId;
  delete ctx.session.lastDraftTextMessageId;
  delete ctx.session.draftSourceMessages;
  delete ctx.session.initialDraftMessageId;
  delete ctx.session.draftEditMode;
  
  logger.debug({ userId: ctx.from?.id }, "Draft session cleared");
}

export function clearChannelSession(ctx: BotContext) {
  delete ctx.session.selectedChannelChatId;
  delete ctx.session.awaitingChannelRef;
  
  logger.debug({ userId: ctx.from?.id }, "Channel session cleared");
}

// Periodic cleanup for stale sessions (if needed in the future)
export class SessionManager {
  private static staleSessions = new Map<number, number>(); // userId -> lastActivity
  private static readonly STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

  static markActivity(userId: number) {
    this.staleSessions.set(userId, Date.now());
  }

  static isStale(userId: number): boolean {
    const lastActivity = this.staleSessions.get(userId);
    if (!lastActivity) return false;
    
    return Date.now() - lastActivity > this.STALE_THRESHOLD;
  }

  static cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, lastActivity] of this.staleSessions.entries()) {
      if (now - lastActivity > this.STALE_THRESHOLD) {
        this.staleSessions.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, "Cleaned up stale session tracking");
    }
  }
}
