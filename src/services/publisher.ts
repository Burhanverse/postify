import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { bot } from "../telegram/bot";
import { InlineKeyboard } from "grammy";
import { ChannelModel } from "../models/Channel";

export async function publishPost(post: Post & { _id: Types.ObjectId }) {
  const channel = await ChannelModel.findById(post.channel);
  if (!channel) return;
  const chatId = channel.chatId;

  const keyboard = new InlineKeyboard();
  post.buttons?.forEach(
    (b: {
      text?: string | null;
      url?: string | null;
      callbackData?: string | null;
    }) => {
      if (b.url) keyboard.url(b.text || "🔗", b.url);
      else if (b.callbackData)
        keyboard.text(
          b.text || "•",
          `btn:${post._id.toString()}:${b.callbackData}`,
        );
    },
  );

  let sent;
  if (post.type === "photo" && post.mediaFileId) {
    sent = await bot.api.sendPhoto(chatId, post.mediaFileId, {
      caption: post.text || undefined,
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  } else if (post.type === "video" && post.mediaFileId) {
    sent = await bot.api.sendVideo(chatId, post.mediaFileId, {
      caption: post.text || undefined,
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  } else {
    sent = await bot.api.sendMessage(chatId, post.text || "", {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
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

export async function deletePublishedPost(postId: string) {
  const post = await PostModel.findById(postId);
  if (!post || !post.publishedMessageId) return;
  try {
    await bot.api.deleteMessage(post.channelChatId!, post.publishedMessageId);
    await PostModel.updateOne(
      { _id: post._id },
      { $set: { status: "deleted" } },
    );
  } catch (err) {
    logger.warn({ err }, "Failed to delete message (maybe already removed)");
  }
}
