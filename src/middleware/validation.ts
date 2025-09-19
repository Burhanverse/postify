import type { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

export async function validationMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  try {
    // Validate user exists
    if (!ctx.from) {
      logger.warn("Received update without user information");
      return;
    }

    // Validate message text length
    if (ctx.message?.text && ctx.message.text.length > 4096) {
      await ctx.reply(
        "Message is too long. Maximum length is 4096 characters.",
      );
      return;
    }

    // Validate caption length for media
    if (ctx.message?.caption && ctx.message.caption.length > 1024) {
      await ctx.reply(
        "Caption is too long. Maximum length is 1024 characters.",
      );
      return;
    }

    // Validate callback data
    if (ctx.callbackQuery?.data && ctx.callbackQuery.data.length > 64) {
      logger.warn(
        {
          userId: ctx.from.id,
          callbackData: ctx.callbackQuery.data,
        },
        "Callback data too long",
      );
      await ctx.answerCallbackQuery({ text: "Invalid request data" });
      return;
    }

    // Sanitize and validate commands
    if (ctx.message?.text?.startsWith("/")) {
      const sanitized = sanitizeCommand(ctx.message.text);
      if (!sanitized) {
        await ctx.reply("Invalid command format.");
        return;
      }
    }

    // Validate file uploads
    if (ctx.message?.photo || ctx.message?.video || ctx.message?.animation) {
      const validationResult = await validateMediaUpload(ctx);
      if (!validationResult.valid) {
        await ctx.reply(validationResult.message);
        return;
      }
    }

    await next();
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        userId: ctx.from?.id,
      },
      "Validation middleware error",
    );

    await ctx.reply("Input validation failed. Please try again.");
  }
}

function sanitizeCommand(text: string): string | null {
  // Remove potentially harmful characters and limit length
  const cleaned = text.trim().slice(0, 256);

  // Basic command validation
  const commandRegex = /^\/[a-zA-Z][a-zA-Z0-9_]*(\s.*)?$/;
  if (!commandRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

interface MediaValidationResult {
  valid: boolean;
  message: string;
}

async function validateMediaUpload(
  ctx: BotContext,
): Promise<MediaValidationResult> {
  const maxFileSize = 20 * 1024 * 1024; // 20MB

  if (ctx.message?.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get highest resolution

    if (photo.file_size && photo.file_size > maxFileSize) {
      return {
        valid: false,
        message: "Photo is too large. Maximum size is 20MB.",
      };
    }
  }

  if (ctx.message?.video) {
    const video = ctx.message.video;

    if (video.file_size && video.file_size > maxFileSize) {
      return {
        valid: false,
        message: "Video is too large. Maximum size is 20MB.",
      };
    }

    // Additional video validation
    if (video.duration && video.duration > 600) {
      // 10 minutes max
      return {
        valid: false,
        message: "Video is too long. Maximum duration is 10 minutes.",
      };
    }
  }

  return { valid: true, message: "" };
}

export function validatePostData(data: {
  text?: string;
  buttons?: Array<{ text: string; url?: string; callbackData?: string }>;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate text
  if (data.text !== undefined) {
    if (data.text.length > 4096) {
      errors.push("Text is too long (max 4096 characters)");
    }

    // Check for potentially harmful content
    if (containsSuspiciousContent(data.text)) {
      errors.push("Text contains suspicious content");
    }
  }

  // Validate buttons
  if (data.buttons) {
    if (data.buttons.length > 100) {
      errors.push("Too many buttons (max 100)");
    }

    for (const [index, button] of data.buttons.entries()) {
      if (!button.text || button.text.trim().length === 0) {
        errors.push(`Button ${index + 1}: Text is required`);
      }

      if (button.text.length > 64) {
        errors.push(`Button ${index + 1}: Text too long (max 64 characters)`);
      }

      if (button.url) {
        if (!isValidUrl(button.url)) {
          errors.push(`Button ${index + 1}: Invalid URL format`);
        }
      }

      if (button.callbackData && button.callbackData.length > 64) {
        errors.push(
          `Button ${index + 1}: Callback data too long (max 64 characters)`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function containsSuspiciousContent(text: string): boolean {
  // Basic patterns to detect potentially harmful content
  const suspiciousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(text));
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "tg:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
