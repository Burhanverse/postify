import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { InlineKeyboard, Bot } from "grammy";
import { ChannelModel, ChannelDoc } from "../models/Channel";
import { UserBotModel } from "../models/UserBot";
import { getOrCreateUserBot, forceStopBot } from "./userBotRegistry";
import { BotContext } from "../telegram/bot";

export async function publishPost(post: Post & { _id: Types.ObjectId }) {
  const channel = await ChannelModel.findById(post.channel);
  if (!channel) {
    logger.error({ postId: post._id.toString() }, "Channel not found for post");
    throw new Error("Channel not found");
  }

  const chatId = channel.chatId;
  logger.info(
    { postId: post._id.toString(), chatId },
    "Publishing post to channel",
  );

  if (!channel.botId) {
    logger.error({ channelId: channel._id }, "Channel missing botId – blocked");
    throw new Error(
      "Channel not bound to personal bot. Relink via personal bot /addchannel.",
    );
  }

  const userBotRecord = await UserBotModel.findOne({
    botId: channel.botId,
    status: "active",
  });
  if (!userBotRecord) {
    throw new Error("Personal bot inactive or missing.");
  }

  // Retry logic for bot conflicts
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    try {
      logger.debug(
        { chatId, botId: userBotRecord.botId, attempt: retryCount + 1 },
        "Publisher: fetching personal bot & checking permissions",
      );
      const personalBot = await getOrCreateUserBot(userBotRecord.botId);
      const botMember = await personalBot.api.getChatMember(
        chatId,
        userBotRecord.botId,
      );
      const canPost =
        botMember.status === "administrator" || botMember.status === "creator";
      if (!canPost) throw new Error("Personal bot lacks posting rights");
      logger.debug(
        { chatId, botId: userBotRecord.botId },
        "Publisher: permission check passed",
      );

      // Return the bot instance for reuse
      return await publishWithBot(post, channel, chatId, personalBot);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check if this is a 409 conflict error
      if (errorMessage.includes("409") && errorMessage.includes("Conflict")) {
        retryCount++;
        logger.warn(
          {
            err,
            chatId,
            botId: userBotRecord.botId,
            attempt: retryCount,
            maxRetries,
          },
          "409 conflict detected in publisher - retrying after delay",
        );

        if (retryCount > maxRetries) {
          logger.error(
            { err, chatId, botId: userBotRecord.botId, attempts: retryCount },
            "Max retries exceeded for 409 conflict - forcing bot cleanup",
          );
          
          // Force stop the bot to clean up any zombie instances
          try {
            await forceStopBot(userBotRecord.botId);
            logger.info(
              { botId: userBotRecord.botId },
              "Force stopped bot after persistent 409 conflicts",
            );
          } catch (forceStopError) {
            logger.error(
              { forceStopError, botId: userBotRecord.botId },
              "Error during force stop",
            );
          }
          
          throw new Error(
            "Bot instance conflict detected. Bot has been reset. Please try again in a few moments.",
          );
        }

        // For retries, force stop the bot first to ensure clean restart
        if (retryCount === 1) {
          logger.info(
            { botId: userBotRecord.botId },
            "First 409 retry - performing force stop for clean restart",
          );
          try {
            await forceStopBot(userBotRecord.botId);
          } catch (forceStopError) {
            logger.warn(
              { forceStopError, botId: userBotRecord.botId },
              "Error during force stop before retry",
            );
          }
        }

        // Wait before retry (exponential backoff)
        const delayMs = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
        logger.debug({ delayMs, attempt: retryCount }, "Waiting before retry");
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue; // Retry the loop
      }

      // For non-409 errors, don't retry
      logger.warn(
        { err, chatId, botId: userBotRecord.botId },
        "Failed permission check for personal bot - not retrying",
      );
      throw err instanceof Error ? err : new Error("Permission check failed");
    }
  }
}

// Separate function to handle the actual publishing with the bot instance
async function publishWithBot(
  post: Post & { _id: Types.ObjectId },
  channel: ChannelDoc,
  chatId: number,
  personalBot: Bot<BotContext>,
) {
  const keyboard = new InlineKeyboard();
  let hasButtons = false;

  post.buttons?.forEach(
    (
      b: {
        text?: string | null;
        url?: string | null;
        callbackData?: string | null;
      },
      index: number,
    ) => {
      if (b.url && b.text) {
        keyboard.url(b.text, b.url);
        hasButtons = true;
      } else if (b.callbackData && b.text) {
        keyboard.text(b.text, `btn:${post._id.toString()}:${b.callbackData}`);
        hasButtons = true;
      }

      // Add row break after every 2 buttons
      if ((index + 1) % 2 === 0) {
        keyboard.row();
      }
    },
  );

  const sendOptions = {
    reply_markup: hasButtons ? keyboard : undefined,
    parse_mode: "HTML" as const,
    disable_web_page_preview: true,
  };

  let sent;
  try {
    logger.debug(
      { postId: post._id.toString(), chatId },
      "Publisher: sending message",
    );
    // Use the existing bot instance instead of calling getOrCreateUserBot again
    if (post.type === "photo" && post.mediaFileId) {
      sent = await personalBot.api.sendPhoto(chatId, post.mediaFileId, {
        caption: post.text || undefined,
        ...sendOptions,
      });
    } else if (post.type === "video" && post.mediaFileId) {
      sent = await personalBot.api.sendVideo(chatId, post.mediaFileId, {
        caption: post.text || undefined,
        ...sendOptions,
      });
    } else {
      sent = await personalBot.api.sendMessage(
        chatId,
        post.text || "",
        sendOptions,
      );
    }
    logger.debug(
      { postId: post._id.toString(), chatId, messageId: sent?.message_id },
      "Publisher: message sent, updating DB",
    );
  } catch (err) {
    logger.error(
      { err, postId: post._id.toString(), chatId },
      "Failed to send message to Telegram",
    );
    throw err;
  }

  await PostModel.updateOne(
    { _id: post._id },
    {
      $set: {
        status: "published",
        publishedMessageId: sent.message_id,
        publishedAt: new Date(),
      },
    },
  );

  // Pin the message if requested
  if (post.pinAfterPosting) {
    try {
      // Use the existing bot instance instead of calling getOrCreateUserBot again
      await personalBot.api.pinChatMessage(chatId, sent.message_id);

      await PostModel.updateOne(
        { _id: post._id },
        {
          $set: {
            pinnedAt: new Date(),
          },
        },
      );

      logger.info(
        { postId: post._id.toString(), messageId: sent.message_id },
        "Post pinned successfully",
      );
    } catch (err) {
      logger.error(
        { err, postId: post._id.toString(), messageId: sent.message_id },
        "Failed to pin message after posting",
      );
      // Don't throw error for pinning failure - the post was still published successfully
    }
  }

  logger.info(
    { postId: post._id.toString(), messageId: sent.message_id },
    "Post published",
  );
}
