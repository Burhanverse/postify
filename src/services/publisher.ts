import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { InlineKeyboard } from "grammy";
import { ChannelModel } from "../models/Channel";
import { UserBotModel } from "../models/UserBot";
import { getOrCreateUserBot } from "./userBotRegistry";

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

  try {
    logger.debug(
      { chatId, botId: userBotRecord.botId },
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
  } catch (err) {
    logger.warn(
      { err, chatId, botId: userBotRecord.botId },
      "Failed permission check for personal bot",
    );
    throw err instanceof Error ? err : new Error("Permission check failed");
  }

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
    const personalBot = await getOrCreateUserBot(channel.botId);
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
      const personalBot = await getOrCreateUserBot(channel.botId);
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
