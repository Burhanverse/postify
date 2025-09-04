import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { InlineKeyboard, Bot } from "grammy";
import { ChannelModel, ChannelDoc } from "../models/Channel";
import { UserBotModel } from "../models/UserBot";
import { getOrCreateUserBot, forceStopBot } from "./userBotRegistry";
import { BotContext } from "../telegram/bot";
import { decrypt } from "../utils/crypto";

// Removed createApiOnlyBot. Always use the polling bot instance for personal bots.

export async function publishPost(post: Post & { _id: Types.ObjectId }) {
  const channel = await ChannelModel.findById(post.channel);
  if (!channel) {
    logger.error({ postId: post._id.toString() }, "Channel not found for post");
    throw new Error("Channel not found");
  }

  const chatId = channel.chatId;

  if (channel.botId) {
    // Personal bot publishing (most common case)
    return publishPersonal(post, channel, chatId);
  } else {
    // Main bot publishing (fallback)
    throw new Error("Main bot publishing not implemented yet");
  }
}

export async function publishPersonal(
  post: Post & { _id: Types.ObjectId },
  channel: ChannelDoc,
  chatId: number,
) {
  const userBotRecord = await UserBotModel.findOne({
    botId: channel.botId,
    status: "active",
  });
  if (!userBotRecord) {
    throw new Error("Personal bot not found for channel");
  }

  try {
    logger.debug(
      { chatId, botId: userBotRecord.botId },
      "Publisher: creating API-only bot & checking permissions",
    );
    
  // Always use the polling bot instance for personal bots
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

    // Use the API-only bot instance for publishing
    return await publishWithBot(post, channel, chatId, personalBot);
  } catch (err) {
    // For API-only bots, most errors are not recoverable by retry
    logger.warn(
      { err, chatId, botId: userBotRecord.botId },
      "Failed to use personal bot for publishing",
    );
    throw err instanceof Error ? err : new Error("Personal bot publishing failed");
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
