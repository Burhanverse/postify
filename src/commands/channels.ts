import { Bot, InlineKeyboard } from "grammy";
import { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";

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

export function registerChannelsCommands(bot: Bot<BotContext>) {
  bot.command("channels", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const channels = await ChannelModel.find({ owners: uid }).limit(25).lean();
    if (!channels.length) {
      await ctx.reply("No channels linked. Use /addchannel.");
      return;
    }
    await ctx.reply("Your channels:", {
      reply_markup: buildChannelsKeyboard(channels),
    });
  });
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
      "❌ **Channel not found**\n\nThe selected channel no longer exists or has been removed.",
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
      `✅ **Channel unlinked**\n\nChannel "${channel.title || channel.username || channel.chatId}" has been removed from your account.`,
      { parse_mode: "Markdown" },
    );
  } else if (action === "list") {
    const channels = await ChannelModel.find({ owners: ctx.from?.id })
      .limit(25)
      .lean();
    if (!channels.length) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        "📭 **No channels linked**\n\nUse /addchannel to connect your first channel.",
        { parse_mode: "Markdown" },
      );
      return true;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("📋 **Your channels:**", {
      reply_markup: buildChannelsKeyboard(channels),
      parse_mode: "Markdown",
    });
  }
  return true;
}
