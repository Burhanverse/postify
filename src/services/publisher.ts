import { PostModel, Post } from "../models/Post";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { InlineKeyboard, Bot, InputFile } from "grammy";
import { env } from "../config/env";
import { ChannelModel, ChannelDoc } from "../models/Channel";
import { UserBotModel } from "../models/UserBot";
import { getExistingUserBot } from "./userBotRegistry";
import type { BotContext } from "../telegram/bot";

export async function publishPost(post: Post & { _id: Types.ObjectId }) {
  const channel = await ChannelModel.findById(post.channel);
  if (!channel) {
    logger.error({ postId: post._id.toString() }, "Channel not found for post");
    throw new Error("Channel not found");
  }

  const chatId = channel.chatId;

  if (channel.botId) {
    return publishPersonal(post, channel, chatId);
  } else {
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

  const personalBot = getExistingUserBot(userBotRecord.botId);

  if (!personalBot) {
    logger.error(
      { botId: userBotRecord.botId },
      "Personal bot not found in registry during publishing",
    );
    throw new Error(
      "Personal bot not available for publishing. Bot may still be starting up - please try again in a moment.",
    );
  }

  logger.debug(
    { chatId, botId: userBotRecord.botId },
    "Publisher: using existing bot instance from registry",
  );

  try {
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

    // Use the polling bot instance for publishing
    return await publishWithBot(post, channel, chatId, personalBot);
  } catch (err) {
    logger.warn(
      { err, chatId, botId: userBotRecord.botId },
      "Failed to use personal bot for publishing",
    );
    throw err instanceof Error
      ? err
      : new Error("Personal bot publishing failed");
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
      "Publisher: sending message using polling bot instance",
    );
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

    // Fallback: file_id might belong to a different bot. Try to fetch via the bot that captured it and reupload.
    if (err instanceof Error && post.mediaFileId && post.type !== "text") {
      const msg = err.message.toLowerCase();
      const looksLikeFileIdIssue =
        msg.includes("wrong file identifier") ||
        msg.includes("file_id") ||
        msg.includes("bad request");
      if (looksLikeFileIdIssue) {
        try {
          logger.warn(
            {
              postId: post._id.toString(),
              chatId,
              mediaOwnerBotId: post.mediaOwnerBotId,
              channelBotId: channel.botId,
            },
            "Attempting cross-bot media fallback: downloading via owner bot and reuploading",
          );

          // Create a short-lived bot with the original token to obtain file URL
          const { UserBotModel } = await import("../models/UserBot");
          const { decrypt } = await import("../utils/crypto");
          let ownerToken: string | undefined;
          if (post.mediaOwnerBotId) {
            const ownerBotRecord = await UserBotModel.findOne({
              botId: post.mediaOwnerBotId,
            });
            ownerToken = ownerBotRecord?.token || undefined;
            if (ownerBotRecord?.tokenEncrypted) {
              const dec = decrypt(ownerBotRecord.tokenEncrypted);
              ownerToken = dec || ownerToken;
            }
          }

          // If not found, as a last resort, try the main bot token from env if matches
          let tempBot: Bot<BotContext> | null = null;
          if (ownerToken) {
            tempBot = new Bot<BotContext>(ownerToken);
          } else if (env.BOT_TOKEN) {
            tempBot = new Bot<BotContext>(env.BOT_TOKEN);
          }

          if (tempBot) {
            // getFile to fetch file path, then construct file URL
      const file = await tempBot.api.getFile(post.mediaFileId);
      const fileUrl = `https://api.telegram.org/file/bot${tempBot.token}/${file.file_path}`;

            if (post.type === "photo") {
              sent = await personalBot.api.sendPhoto(
                chatId,
        new InputFile(new URL(fileUrl)),
                { caption: post.text || undefined, ...sendOptions },
              );
            } else if (post.type === "video") {
              sent = await personalBot.api.sendVideo(
                chatId,
        new InputFile(new URL(fileUrl)),
                { caption: post.text || undefined, ...sendOptions },
              );
            }

            logger.info(
              { postId: post._id.toString(), chatId, messageId: sent?.message_id },
              "Fallback succeeded: media reuploaded via source bot",
            );
          } else {
            logger.warn(
              { postId: post._id.toString(), chatId },
              "Fallback unavailable: media owner bot token not found",
            );
          }
        } catch (fallbackErr) {
          logger.error(
            { fallbackErr, postId: post._id.toString(), chatId },
            "Cross-bot media fallback failed",
          );
          throw err;
        }
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

    if (!sent) {
      // If we reach here without throwing, ensure we don't continue with undefined
      throw new Error("Failed to send message: no response from Telegram API");
    }

  // Extract new media file_id if available to avoid future cross-bot issues
  let newMediaFileId: string | undefined;
  if (post.type === "photo" && "photo" in sent && Array.isArray(sent.photo)) {
    newMediaFileId = sent.photo.at(-1)?.file_id;
  } else if (post.type === "video" && "video" in sent && sent.video) {
    newMediaFileId = sent.video.file_id;
  }

  await PostModel.updateOne(
    { _id: post._id },
    {
      $set: {
        status: "published",
        publishedMessageId: sent!.message_id,
        publishedAt: new Date(),
        ...(newMediaFileId
          ? { mediaFileId: newMediaFileId, mediaOwnerBotId: channel.botId }
          : {}),
      },
    },
  );

  // Pin the message if requested
  if (post.pinAfterPosting) {
    try {
      await personalBot.api.pinChatMessage(chatId, sent!.message_id);

      await PostModel.updateOne(
        { _id: post._id },
        {
          $set: {
            pinnedAt: new Date(),
          },
        },
      );

      logger.info(
        { postId: post._id.toString(), messageId: sent!.message_id },
        "Post pinned successfully using polling bot",
      );
    } catch (err) {
      logger.error(
        { err, postId: post._id.toString(), messageId: sent!.message_id },
        "Failed to pin message after posting",
      );
      // Don't throw error for pinning failure - the post was still published successfully
    }
  }

  logger.info(
    { postId: post._id.toString(), messageId: sent!.message_id },
    "Post published",
  );
}
