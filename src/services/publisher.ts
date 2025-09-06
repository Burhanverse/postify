import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { InlineKeyboard } from "grammy";
import { ChannelModel } from "../models/Channel";
import { UserBotModel } from "../models/UserBot";
import { getExistingUserBot } from "./userBotRegistry";
import type { Message } from "grammy/types";

export async function publishPost(post: Post & { _id: Types.ObjectId }) {
  // Resolve channel
  const channel = await ChannelModel.findById(post.channel);
  if (!channel) {
    logger.error({ postId: post._id.toString() }, "Channel not found for post");
    throw new Error("Channel not found");
  }
  if (!channel.botId) {
    throw new Error("Channel missing personal bot link");
  }

  // SECURITY: enforce the exact publisher bot
  if (post.publisherBotId && post.publisherBotId !== channel.botId) {
    throw new Error(
      `Post is bound to bot ${post.publisherBotId}, but channel currently uses bot ${channel.botId}. Refusing to publish.`,
    );
  }

  // Resolve active personal bot record and instance
  const userBotRecord = await UserBotModel.findOne({
    botId: channel.botId,
    status: "active",
  });
  if (!userBotRecord) {
    throw new Error("Personal bot not found or inactive for this channel");
  }

  const personalBot = getExistingUserBot(userBotRecord.botId);
  if (!personalBot) {
    throw new Error(
      "Personal bot instance not available. It may still be starting up. Please try again shortly.",
    );
  }

  const chatId = channel.chatId;

  // Permission check
  try {
    const botMember = await personalBot.api.getChatMember(
      chatId,
      userBotRecord.botId,
    );
    const canPost =
      botMember.status === "administrator" || botMember.status === "creator";
    if (!canPost) throw new Error("Personal bot lacks posting rights");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ chatId, botId: userBotRecord.botId, err: msg }, "Permission check failed");
    throw new Error(
      msg.includes("chat not found")
        ? "Channel not found or inaccessible"
        : "Personal bot lacks posting rights",
    );
  }

  // Build keyboard (max 2 buttons per row)
  const keyboard = new InlineKeyboard();
  let hasButtons = false;
  post.buttons?.forEach((b, index) => {
    if (!b) return;
    if (b.url && b.text) {
      keyboard.url(b.text, b.url);
      hasButtons = true;
    } else if (b.callbackData && b.text) {
      keyboard.text(b.text, `btn:${post._id.toString()}:${b.callbackData}`);
      hasButtons = true;
    }
    if ((index + 1) % 2 === 0) keyboard.row();
  });

  const sendOptions = {
    reply_markup: hasButtons ? keyboard : undefined,
    parse_mode: "HTML" as const,
    disable_web_page_preview: true,
  };

  // Send the message strictly via the bound personal bot
  let sent: Message;
  try {
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
  } catch (err) {
    logger.error(
      { err, postId: post._id.toString(), chatId },
      "Failed to send message via personal bot",
    );
    throw err instanceof Error ? err : new Error("Failed to send message");
  }

  if (!sent) {
    throw new Error("Failed to send message: no response from Telegram API");
  }

  // Capture new media file_id (safe: same bot)
  let newMediaFileId: string | undefined;
  if (post.type === "photo" && sent.photo && Array.isArray(sent.photo)) {
    newMediaFileId = sent.photo.at(-1)?.file_id;
  } else if (post.type === "video" && sent.video) {
    newMediaFileId = sent.video.file_id;
  }

  await PostModel.updateOne(
    { _id: post._id },
    {
      $set: {
        status: "published",
        publishedMessageId: sent.message_id,
        publishedAt: new Date(),
        ...(newMediaFileId
          ? { mediaFileId: newMediaFileId, mediaOwnerBotId: channel.botId }
          : {}),
      },
    },
  );

  // Optionally pin
  if (post.pinAfterPosting) {
    try {
      await personalBot.api.pinChatMessage(chatId, sent.message_id);
      await PostModel.updateOne(
        { _id: post._id },
        { $set: { pinnedAt: new Date() } },
      );
    } catch (err) {
      logger.error(
        { err, postId: post._id.toString(), messageId: sent.message_id },
        "Failed to pin message after posting",
      );
      // Do not throw; publishing succeeded
    }
  }

  logger.info(
    { postId: post._id.toString(), messageId: sent.message_id },
    "Post published",
  );
}
