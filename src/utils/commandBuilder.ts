import { Bot } from "grammy";
import type { BotCommand } from "grammy/types";
import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";

/**
 * Simple protected command wrapper with error handling
 */
export function createProtectedCommand(
  bot: Bot<BotContext>,
  command: string,
  handler: (ctx: BotContext) => Promise<void>,
) {
  bot.command(command, async (ctx) => {
    const startTime = Date.now();

    try {
      await handler(ctx);

      logger.debug(
        {
          command,
          userId: ctx.from?.id,
          duration: Date.now() - startTime,
        },
        `Command ${command} completed successfully`,
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          command,
          userId: ctx.from?.id,
          duration,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        `Command ${command} failed`,
      );

      // Send user-friendly error message
      try {
        await ctx.reply(
          `❌ The /${command} command failed. Please try again later.`,
        );
      } catch (replyError) {
        logger.error(
          {
            command,
            userId: ctx.from?.id,
            replyError:
              replyError instanceof Error
                ? replyError.message
                : String(replyError),
          },
          `Failed to send error message for command ${command}`,
        );
      }
    }
  });
}

/**
 * Simple protected callback wrapper with error handling
 */
export function createProtectedCallback(
  bot: Bot<BotContext>,
  pattern: string | RegExp,
  handler: (ctx: BotContext) => Promise<void>,
) {
  bot.callbackQuery(pattern, async (ctx) => {
    const startTime = Date.now();
    const callbackData = ctx.callbackQuery.data;

    try {
      await handler(ctx);

      logger.debug(
        {
          callbackData,
          userId: ctx.from?.id,
          duration: Date.now() - startTime,
        },
        `Callback ${callbackData} completed successfully`,
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          callbackData,
          userId: ctx.from?.id,
          duration,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        `Callback ${callbackData} failed`,
      );

      // Send user-friendly error message
      try {
        await ctx.answerCallbackQuery({
          text: "❌ Action failed. Please try again.",
          show_alert: true,
        });
      } catch (replyError) {
        logger.error(
          {
            callbackData,
            userId: ctx.from?.id,
            replyError:
              replyError instanceof Error
                ? replyError.message
                : String(replyError),
          },
          `Failed to send error message for callback ${callbackData}`,
        );
      }
    }
  });
}

/**
 * Bulk command registration with consistent error handling
 */
export function registerCommands(
  bot: Bot<BotContext>,
  commands: Array<{
    command: string;
    description: string;
    handler: (ctx: BotContext) => Promise<void>;
  }>,
) {
  const botCommands: BotCommand[] = [];

  for (const { command: cmd, description, handler } of commands) {
    createProtectedCommand(bot, cmd, handler);
    botCommands.push({ command: cmd, description });
  }

  // Set bot commands for better UX
  bot.api.setMyCommands(botCommands).catch((err) => {
    logger.error({ err }, "Failed to set bot commands");
  });
}
