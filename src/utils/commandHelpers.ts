import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";
import { validatePostData } from "../middleware/validation";
import { clearDraftSession } from "../middleware/sessionCleanup";

export async function safeCommandExecution<T>(
  ctx: BotContext,
  operation: () => Promise<T>,
  operationName: string,
  fallbackMessage = "Operation failed. Please try again.",
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId: ctx.from?.id,
        operation: operationName,
      },
      `Command execution failed: ${operationName}`,
    );

    try {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: fallbackMessage,
          show_alert: true,
        });
      } else {
        await ctx.reply(fallbackMessage);
      }
    } catch (replyError) {
      logger.error(
        {
          error:
            replyError instanceof Error
              ? replyError.message
              : String(replyError),
          userId: ctx.from?.id,
        },
        "Failed to send error message",
      );
    }

    return null;
  }
}

export async function safeDraftOperation(
  ctx: BotContext,
  operation: () => Promise<void>,
  operationName: string,
): Promise<boolean> {
  try {
    // Validate draft data before operation
    if (ctx.session.draft) {
      const validation = validatePostData({
        text: ctx.session.draft.text,
        buttons: ctx.session.draft.buttons,
      });

      if (!validation.valid) {
        await ctx.reply(
          `Draft validation failed:\n${validation.errors.join("\n")}`,
        );
        return false;
      }
    }

    await operation();
    return true;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        userId: ctx.from?.id,
        operation: operationName,
        draftData: ctx.session.draft,
      },
      `Draft operation failed: ${operationName}`,
    );

    // Clear corrupted draft session
    clearDraftSession(ctx);

    try {
      await ctx.reply(
        "Draft operation failed. Draft has been cleared. Please start over with /newpost",
      );
    } catch (replyError) {
      logger.error(
        {
          error:
            replyError instanceof Error
              ? replyError.message
              : String(replyError),
          userId: ctx.from?.id,
        },
        "Failed to send draft error message",
      );
    }

    return false;
  }
}

export function wrapCommand(
  commandHandler: (ctx: BotContext) => Promise<void>,
  commandName: string,
) {
  return async (ctx: BotContext) => {
    await safeCommandExecution(
      ctx,
      () => commandHandler(ctx),
      commandName,
      `${commandName} command failed. Please try again.`,
    );
  };
}

export function wrapCallbackHandler(
  callbackHandler: (ctx: BotContext) => Promise<void>,
  handlerName: string,
) {
  return async (ctx: BotContext) => {
    await safeCommandExecution(
      ctx,
      () => callbackHandler(ctx),
      `callback:${handlerName}`,
      "Action failed. Please try again.",
    );
  };
}

export async function validateChannelAccess(
  ctx: BotContext,
  channelChatId: number,
): Promise<boolean> {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Authentication required.");
      return false;
    }

    const { ChannelModel } = await import("../models/Channel");
    const channel = await ChannelModel.findOne({
      chatId: channelChatId,
      owners: userId,
    });

    if (!channel) {
      await ctx.reply(
        "You don't have access to this channel. Use /channels to select an available channel.",
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        userId: ctx.from?.id,
        channelChatId,
      },
      "Channel access validation failed",
    );

    await ctx.reply("Failed to validate channel access. Please try again.");
    return false;
  }
}
