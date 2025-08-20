import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

interface LockEntry {
  userId: number;
  action: string;
  timestamp: number;
  promise: Promise<void>;
}

class ConcurrencyManager {
  private locks = new Map<string, LockEntry>();
  private userLocks = new Map<number, Set<string>>();
  private readonly lockTimeout = 30000; // 30 seconds max lock time

  constructor() {
    // Cleanup expired locks every minute
    setInterval(() => this.cleanupExpiredLocks(), 60000);
  }

  async acquireLock(
    userId: number,
    resource: string,
    action: string,
  ): Promise<boolean> {
    const lockKey = `${resource}:${userId}`;
    const now = Date.now();

    // Check if lock already exists and is still valid
    const existingLock = this.locks.get(lockKey);
    if (existingLock && now - existingLock.timestamp < this.lockTimeout) {
      logger.debug(
        {
          userId,
          resource,
          action,
          existingAction: existingLock.action,
        },
        "Lock already exists for user resource",
      );
      return false;
    }

    // Create new lock
    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    const lockEntry: LockEntry = {
      userId,
      action,
      timestamp: now,
      promise: lockPromise,
    };

    this.locks.set(lockKey, lockEntry);

    // Track user locks
    if (!this.userLocks.has(userId)) {
      this.userLocks.set(userId, new Set());
    }
    this.userLocks.get(userId)!.add(lockKey);

    // Auto-release lock after timeout
    setTimeout(() => {
      this.releaseLock(userId, resource);
    }, this.lockTimeout);

    logger.debug(
      {
        userId,
        resource,
        action,
        lockKey,
      },
      "Lock acquired",
    );

    return true;
  }

  releaseLock(userId: number, resource: string): void {
    const lockKey = `${resource}:${userId}`;
    const lock = this.locks.get(lockKey);

    if (lock) {
      this.locks.delete(lockKey);

      // Remove from user locks
      const userLockSet = this.userLocks.get(userId);
      if (userLockSet) {
        userLockSet.delete(lockKey);
        if (userLockSet.size === 0) {
          this.userLocks.delete(userId);
        }
      }

      logger.debug(
        {
          userId,
          resource,
          lockKey,
        },
        "Lock released",
      );
    }
  }

  private cleanupExpiredLocks(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [lockKey, lock] of this.locks.entries()) {
      if (now - lock.timestamp > this.lockTimeout) {
        this.locks.delete(lockKey);

        // Remove from user locks
        const userLockSet = this.userLocks.get(lock.userId);
        if (userLockSet) {
          userLockSet.delete(lockKey);
          if (userLockSet.size === 0) {
            this.userLocks.delete(lock.userId);
          }
        }

        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug({ cleanedCount }, "Cleaned up expired locks");
    }
  }

  isLocked(userId: number, resource: string): boolean {
    const lockKey = `${resource}:${userId}`;
    const lock = this.locks.get(lockKey);

    if (!lock) return false;

    const now = Date.now();
    return now - lock.timestamp < this.lockTimeout;
  }

  getUserActiveLocks(userId: number): string[] {
    const userLockSet = this.userLocks.get(userId);
    return userLockSet ? Array.from(userLockSet) : [];
  }
}

const concurrencyManager = new ConcurrencyManager();

export async function concurrencyMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  const userId = ctx.from?.id;
  if (!userId) {
    await next();
    return;
  }

  const resource = getResourceFromContext(ctx);
  const action = getActionFromContext(ctx);

  // Skip concurrency control for read-only operations
  if (isReadOnlyAction(action)) {
    await next();
    return;
  }

  const acquired = await concurrencyManager.acquireLock(
    userId,
    resource,
    action,
  );

  if (!acquired) {
    const message =
      "⏳ Please wait for your previous action to complete before starting a new one.";

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
          resource,
          action,
        },
        "Failed to send concurrency message",
      );
    }
    return;
  }

  try {
    await next();
  } finally {
    concurrencyManager.releaseLock(userId, resource);
  }
}

function getResourceFromContext(ctx: BotContext): string {
  const userId = ctx.from?.id;

  // For draft operations, lock per user
  if (
    ctx.message?.text?.startsWith("/newpost") ||
    ctx.callbackQuery?.data?.startsWith("draft:") ||
    (ctx.session && ctx.session.draft)
  ) {
    return `draft:${userId}`;
  }

  // For channel operations, lock per channel
  if (ctx.session && ctx.session.selectedChannelChatId) {
    return `channel:${ctx.session.selectedChannelChatId}`;
  }

  // For scheduling operations, lock per user
  if (ctx.message?.text?.startsWith("/schedule")) {
    return `schedule:${userId}`;
  }

  // Default to user-level locking
  return `user:${userId}`;
}

function getActionFromContext(ctx: BotContext): string {
  if (ctx.message?.text?.startsWith("/")) {
    return ctx.message.text.split(" ")[0];
  }
  if (ctx.callbackQuery?.data) {
    return `callback:${ctx.callbackQuery.data.split(":")[0]}`;
  }
  return "message";
}

function isReadOnlyAction(action: string): boolean {
  const readOnlyActions = [
    "/help",
    "/start",
    "/listposts",
    "/queue",
    "/channels",
    "/admins",
    "/checkchannels",
    "callback:preview",
  ];

  return readOnlyActions.includes(action) || action.startsWith("callback:list");
}
