import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";
import { BotError, GrammyError, HttpError } from "grammy";

export async function errorHandlerMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  try {
    await next();
  } catch (error) {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const messageId = ctx.message?.message_id;

    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        chatId,
        messageId,
        updateType: ctx.update.message
          ? "message"
          : ctx.update.callback_query
            ? "callback_query"
            : "unknown",
      },
      "Bot error caught by middleware",
    );

    // Handle different types of errors
    if (error instanceof GrammyError) {
      await handleGrammyError(ctx, error);
    } else if (error instanceof HttpError) {
      await handleHttpError(ctx, error);
    } else if (error instanceof BotError) {
      await handleBotError(ctx, error);
    } else {
      await handleUnknownError(ctx, error);
    }
  }
}

async function handleGrammyError(ctx: BotContext, error: GrammyError) {
  const errorCode = error.error_code;
  const description = error.description;

  logger.warn(
    {
      errorCode,
      description,
      userId: ctx.from?.id,
    },
    "Grammy API error",
  );

  switch (errorCode) {
    case 400:
      if (description.includes("message is not modified")) {
        // Silent ignore - trying to edit message with same content
        return;
      }
      if (description.includes("message to edit not found")) {
        await safeReply(ctx, "❌ Message not found. Please try again.");
        return;
      }
      if (description.includes("chat not found")) {
        await safeReply(
          ctx,
          "❌ Channel not found. Please check your channel settings with /checkchannels",
        );
        return;
      }
      break;

    case 403:
      if (description.includes("bot was blocked")) {
        logger.info({ userId: ctx.from?.id }, "User blocked the bot");
        return;
      }
      if (description.includes("not enough rights")) {
        await safeReply(
          ctx,
          "❌ Bot doesn't have enough permissions. Please grant admin rights to the bot.",
        );
        return;
      }
      break;

    case 429:
      await safeReply(
        ctx,
        "⏳ Too many requests. Please wait a moment and try again.",
      );
      return;

    case 500:
    case 502:
    case 503:
      await safeReply(
        ctx,
        "🔧 Telegram is experiencing issues. Please try again in a few minutes.",
      );
      return;
  }

  // Generic Grammy error
  await safeReply(
    ctx,
    "❌ An error occurred while processing your request. Please try again.",
  );
}

async function handleHttpError(ctx: BotContext, error: HttpError) {
  logger.error(
    {
      status: error.message,
      userId: ctx.from?.id,
    },
    "HTTP error",
  );

  await safeReply(
    ctx,
    "🌐 Network error. Please check your connection and try again.",
  );
}

async function handleBotError(ctx: BotContext, error: BotError) {
  logger.error(
    {
      error: error.message,
      userId: ctx.from?.id,
    },
    "Bot error",
  );

  await safeReply(ctx, "🤖 Bot configuration error. Please contact support.");
}

async function handleUnknownError(ctx: BotContext, error: unknown) {
  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userId: ctx.from?.id,
    },
    "Unknown error",
  );

  await safeReply(
    ctx,
    "❌ An unexpected error occurred. Please try again later.",
  );
}

async function safeReply(ctx: BotContext, text: string) {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text, show_alert: true });
    } else {
      await ctx.reply(text);
    }
  } catch (replyError) {
    logger.error(
      {
        error:
          replyError instanceof Error ? replyError.message : String(replyError),
        userId: ctx.from?.id,
        originalText: text,
      },
      "Failed to send error message to user",
    );
  }
}
