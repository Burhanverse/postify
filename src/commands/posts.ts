import { Bot } from "grammy";
import { BotContext } from "../telegram/bot.js";
import { PostModel } from "../models/Post.js";
import { ChannelModel } from "../models/Channel.js";
import { schedulePost } from "../services/agenda.js";
import { DateTime } from "luxon";

export function registerPostCommands(bot: Bot<BotContext>) {
  bot.command("newpost", async (ctx) => {
    ctx.session.draft = { postType: "text" };
    await ctx.reply("Send the text for the post.");
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.session.draft && !ctx.session.draft.text) {
      ctx.session.draft.text = ctx.message.text;
      await ctx.reply(
        "Draft saved. Use /schedule to schedule or /publish to post now (not implemented yet).",
      );
      return;
    }
    return next();
  });

  bot.command("schedule", async (ctx) => {
    if (!ctx.session.draft?.text) {
      await ctx.reply("No draft to schedule. Use /newpost first.");
      return;
    }
    const when = DateTime.utc().plus({ minutes: 2 }).toJSDate();
    const channel = await ChannelModel.findOne({ owners: ctx.from?.id });
    if (!channel) {
      await ctx.reply("No linked channel. Use /addchannel first.");
      return;
    }
    const post = await PostModel.create({
      channel: channel._id,
      channelChatId: channel.chatId,
      authorTgId: ctx.from?.id,
      status: "scheduled",
      type: "text",
      text: ctx.session.draft.text,
      scheduledAt: when,
    });
    await schedulePost(post.id, when, "UTC");
    delete ctx.session.draft;
    await ctx.reply(`Post scheduled for ${when.toISOString()}`);
  });

  bot.command("queue", async (ctx) => {
    const channel = await ChannelModel.findOne({ owners: ctx.from?.id });
    if (!channel) {
      await ctx.reply("No linked channel.");
      return;
    }
    const upcoming = await PostModel.find({
      channel: channel._id,
      status: "scheduled",
    })
      .sort({ scheduledAt: 1 })
      .limit(10);
    if (!upcoming.length) {
      await ctx.reply("Queue empty.");
      return;
    }
    await ctx.reply(
      upcoming
        .map((p) => `${p.id} -> ${p.scheduledAt?.toISOString()}`)
        .join("\n"),
    );
  });
}
