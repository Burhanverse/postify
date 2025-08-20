import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

interface RateLimitEntry {
  count: number;
  resetTime: number;
  lastAction: string;
}

class RateLimiter {
  private limits = new Map<number, RateLimitEntry>();
  private readonly maxRequests = 10; // requests per window
  private readonly windowMs = 60000; // 1 minute window
  private readonly cleanupInterval = 300000; // cleanup every 5 minutes

  constructor() {
    // Periodic cleanup of expired entries
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  isRateLimited(userId: number, action: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(userId);

    if (!entry || now > entry.resetTime) {
      // Reset or create new entry
      this.limits.set(userId, {
        count: 1,
        resetTime: now + this.windowMs,
        lastAction: action,
      });
      return false;
    }

    if (entry.count >= this.maxRequests) {
      logger.warn(
        {
          userId,
          action,
          count: entry.count,
          lastAction: entry.lastAction,
        },
        "Rate limit exceeded",
      );
      return true;
    }

    entry.count++;
    entry.lastAction = action;
    return false;
  }

  private cleanup() {
    const now = Date.now();
    for (const [userId, entry] of this.limits.entries()) {
      if (now > entry.resetTime) {
        this.limits.delete(userId);
      }
    }
  }

  getRemainingTime(userId: number): number {
    const entry = this.limits.get(userId);
    if (!entry) return 0;
    return Math.max(0, entry.resetTime - Date.now());
  }
}

const rateLimiter = new RateLimiter();

export async function rateLimitMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  const userId = ctx.from?.id;
  if (!userId) {
    await next();
    return;
  }

  const action = getActionFromContext(ctx);

  if (rateLimiter.isRateLimited(userId, action)) {
    const remainingMs = rateLimiter.getRemainingTime(userId);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    const message = `⏳ You're sending commands too quickly. Please wait ${remainingSeconds} seconds before trying again.`;

    try {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: message, show_alert: true });
      } else {
        await ctx.reply(message);
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
        },
        "Failed to send rate limit message",
      );
    }
    return;
  }

  await next();
}

function getActionFromContext(ctx: BotContext): string {
  if (ctx.message?.text?.startsWith("/")) {
    return ctx.message.text.split(" ")[0];
  }
  if (ctx.callbackQuery?.data) {
    return `callback:${ctx.callbackQuery.data.split(":")[0]}`;
  }
  if (ctx.message?.photo) {
    return "photo_upload";
  }
  if (ctx.message?.video) {
    return "video_upload";
  }
  if (ctx.message?.text) {
    return "text_message";
  }
  return "unknown_action";
}
