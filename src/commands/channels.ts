import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";
import { logger } from "../utils/logger";

export async function getUserChannels(userId?: number, botId?: number) {
  if (!userId) return [];
  const query: Record<string, unknown> = { owners: userId };
  if (botId) {
    query.botId = botId;
  }
  return await ChannelModel.find(query).limit(25).lean();
}

function buildChannelsKeyboard(
  channels: {
    chatId: number;
    title?: string | null;
    username?: string | null;
  }[],
) {
  const kb = new InlineKeyboard();
  channels.forEach((c) => {
    const label =
      c.title || (c.username ? "@" + c.username : c.chatId.toString());
    kb.text(label, `ch:i:${c.chatId}`);
    kb.row();
  });
  return kb;
}

interface ChannelCommandOptions {
  enableLinking?: boolean;
}

export function registerChannelsCommands(
  bot: Bot<BotContext>,
  opts: ChannelCommandOptions = {},
) {
  bot.command("channels", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const channels = await ChannelModel.find({ 
      owners: uid,
      ...(opts.enableLinking ? { botId: ctx.me.id } : {})
    }).limit(25).lean();
    if (!channels.length) {
      await ctx.reply(
        opts.enableLinking
          ? "No channels linked. Use /addchannel."
          : "No channels linked. Link via your personal bot /addchannel.",
      );
      return;
    }
    await ctx.reply("Your channels:", {
      reply_markup: buildChannelsKeyboard(channels),
    });
  });

  if (opts.enableLinking) {
    bot.command("addchannel", async (ctx) => {
      await ctx.reply(
        "Send @username of a public channel or forward a message from the private channel where THIS personal bot is admin.",
      );
      ctx.session.awaitingChannelRef = true;
    });

    bot.on("message", async (ctx, next) => {
      if (!ctx.session.awaitingChannelRef) return next();
      const msg = ctx.message;
      let chatId: number | undefined;
      let username: string | undefined;
      let title: string | undefined;
      let type: string | undefined;
      let inviteLink: string | undefined;

      interface ForwardedChannelRef {
        id: number;
        username?: string;
        title?: string;
        type: string;
      }
      const fwdChat = (msg as { forward_from_chat?: ForwardedChannelRef })
        .forward_from_chat;
      if (fwdChat) {
        const ch = fwdChat;
        chatId = ch.id;
        username = ch.username || undefined;
        title = ch.title || undefined;
        type = ch.type;
      } else if (msg.text && /^@\w{4,}$/.test(msg.text.trim())) {
        username = msg.text.trim().slice(1);
        try {
          const chat = await ctx.api.getChat("@" + username);
          chatId = chat.id;
          const chatShape = chat as {
            id: number;
            type: string;
            title?: string;
          };
          title = chatShape.title;
          type = chat.type;
        } catch (err) {
          logger.warn(
            {
              error: err instanceof Error ? err.message : String(err),
              username,
              userId: ctx.from?.id,
            },
            "Failed to get chat info via personal bot",
          );
          await ctx.reply(
            "Cannot access channel. Ensure your personal bot is an admin.",
          );
          return;
        }
      } else {
        return next();
      }

      if (!chatId) {
        await ctx.reply("Failed to resolve channel. Try forwarding a message.");
        return;
      }

      let member;
      try {
        member = await ctx.api.getChatMember(chatId, ctx.me.id);
      } catch (err) {
        logger.warn(
          {
            error: err instanceof Error ? err.message : String(err),
            chatId,
            userId: ctx.from?.id,
          },
          "Failed to check personal bot membership",
        );
        await ctx.reply(
          "Unable to access channel member list. Add your personal bot as admin first.",
        );
        return;
      }
      const m = member as { can_post_messages?: boolean; status: string };
      const canPost =
        m.can_post_messages ??
        (m.status === "administrator" || m.status === "creator");
      if (!canPost) {
        await ctx.reply(
          "Unable to post in the channel. Grant the permissions and retry.",
        );
        return;
      }

      await ChannelModel.findOneAndUpdate(
        { chatId, botId: ctx.me.id }, // Unique per bot, not per channel
        {
          $set: {
            chatId,
            username,
            title,
            type,
            inviteLink,
            permissions: { canPost: true, canEdit: true, canDelete: true },
            botId: ctx.me.id,
          },
          $addToSet: { owners: ctx.from?.id },
        },
        { upsert: true },
      );

      delete ctx.session.awaitingChannelRef;
      logger.info(
        {
          userId: ctx.from?.id,
          chatId,
          title,
          username,
          type,
          botId: ctx.me.id,
        },
        "Channel linked via personal bot",
      );
      await ctx.reply(
        `Channel linked to personal bot: ${title || username || chatId}`,
      );
    });
  }
}

export async function handleChannelCallback(ctx: BotContext) {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("ch:")) return false;
  const parts = data.split(":");
  const action = parts[1];
  const chatIdPart = parts[2];
  const chatId = chatIdPart ? Number(chatIdPart) : undefined;
  let channel = null;
  if (chatId !== undefined && !Number.isNaN(chatId)) {
    channel = await ChannelModel.findOne({ chatId });
  }
  if ((action === "i" || action === "u" || action === "uc") && !channel) {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "**Channel not found**\n\nThe selected channel no longer exists or has been removed.",
      { parse_mode: "Markdown" },
    );
    return true;
  }

  if (action === "i" && channel) {
    const text = `Channel Info\nTitle: ${channel.title}\nUsername: ${channel.username ? "@" + channel.username : "—"}\nChatId: ${channel.chatId}`;
    const kb = new InlineKeyboard()
      .text("Unlink", `ch:u:${channel.chatId}`)
      .row()
      .text("Back", "ch:list");
    await ctx.editMessageText(text, { reply_markup: kb });
  } else if (action === "u" && channel) {
    const kb = new InlineKeyboard()
      .text("Confirm unlink", `ch:uc:${chatId}`)
      .row()
      .text("Cancel", `ch:i:${chatId}`);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  } else if (action === "uc" && channel) {
    await ChannelModel.updateOne(
      { chatId },
      { $pull: { owners: ctx.from?.id } },
    );
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `**Channel unlinked**\n\nChannel "${channel.title || channel.username || channel.chatId}" has been removed from your account.`,
      { parse_mode: "Markdown" },
    );
  } else if (action === "list") {
    const channels = await ChannelModel.find({ owners: ctx.from?.id })
      .limit(25)
      .lean();
    if (!channels.length) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        "**No channels linked**\n\nUse /addchannel to connect your first channel.",
        { parse_mode: "Markdown" },
      );
      return true;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("**Your channels:**", {
      reply_markup: buildChannelsKeyboard(channels),
      parse_mode: "Markdown",
    });
  }
  return true;
}
