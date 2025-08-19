import { Bot } from "grammy";
import { BotContext } from "../telegram/bot.js";
import { PostModel } from "../models/Post.js";

export function registerStatsCommands(bot: Bot<BotContext>) {
  bot.command("stats", async (ctx) => {
    const arg = ctx.match; // expecting post id maybe
    if (!arg) {
      await ctx.reply("Usage: /stats <postId>");
      return;
    }
    const post = await PostModel.findById(arg.trim());
    if (!post) return ctx.reply("Post not found");
    await ctx.reply(
      `Post stats:\nViews: ${post.viewCount}\nButton clicks: ${[...(post.buttonClicks?.entries() || [])].map(([k, v]) => `${k}:${v}`).join(", ")}`,
    );
  });
}
