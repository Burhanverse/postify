import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { bot } from "../telegram/bot";
import { InlineKeyboard } from "grammy";
import { ChannelModel } from "../models/Channel";

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

  // Validate bot is still in the channel and has permissions
  try {
    const me = await bot.api.getMe();
    const botMember = await bot.api.getChatMember(chatId, me.id);
    const canPost =
      botMember.status === "administrator" || botMember.status === "creator";

    if (!canPost) {
      throw new Error("Bot doesn't have permission to post in this channel");
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("chat not found")) {
        throw new Error(
          "Channel not found. The bot may have been removed from the channel.",
        );
      } else if (err.message.includes("not enough rights")) {
        throw new Error(
          "Bot doesn't have permission to access channel information",
        );
      }
    }
    throw err;
  }

  const keyboard = new InlineKeyboard();
  let hasButtons = false;

  post.buttons?.forEach(
    (b: {
      text?: string | null;
      url?: string | null;
      callbackData?: string | null;
    }) => {
      if (b.url && b.text) {
        keyboard.url(b.text, b.url);
        hasButtons = true;
      } else if (b.callbackData && b.text) {
        keyboard.text(b.text, `btn:${post._id.toString()}:${b.callbackData}`);
        hasButtons = true;
      }
    },
  );

  const sendOptions = {
    reply_markup: hasButtons ? keyboard : undefined,
    parse_mode: "HTML" as const,
  };

  let sent;
  try {
    if (post.type === "photo" && post.mediaFileId) {
      sent = await bot.api.sendPhoto(chatId, post.mediaFileId, {
        caption: post.text || undefined,
        ...sendOptions,
      });
    } else if (post.type === "video" && post.mediaFileId) {
      sent = await bot.api.sendVideo(chatId, post.mediaFileId, {
        caption: post.text || undefined,
        ...sendOptions,
      });
    } else {
      sent = await bot.api.sendMessage(chatId, post.text || "", sendOptions);
    }
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
  logger.info(
    { postId: post._id.toString(), messageId: sent.message_id },
    "Post published",
  );
}
