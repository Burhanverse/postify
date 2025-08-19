import { Bot } from "grammy";
import { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";
interface AdminEntry {
  userId: number;
  roles: string[];
}

function formatRoles(roles?: string[]) {
  return roles?.join(", ") || "none";
}

export function registerAdminCommands(bot: Bot<BotContext>) {
  bot.command("admins", async (ctx) => {
    const channel =
      (await ChannelModel.findOne({
        chatId: ctx.session.selectedChannelChatId,
        owners: ctx.from?.id,
      })) || (await ChannelModel.findOne({ owners: ctx.from?.id }));
    if (!channel)
      return ctx.reply("No channel selected. Use /usechannel <chatId>.");
    const lines = [
      `Owners: ${channel.owners.map((o) => o.toString()).join(", ")}`,
      "Admins:",
      ...(channel.admins || []).map(
        (a) => ` - ${a.userId}: ${formatRoles((a as AdminEntry).roles)}`,
      ),
    ];
    await ctx.reply(lines.join("\n"));
  });

  bot.command("addadmin", async (ctx) => {
    const args = ctx.match?.trim().split(/\s+/) || [];
    if (args.length < 2)
      return ctx.reply("Usage: /addadmin <tgUserId> <role1,role2,...>");
    const userId = Number(args[0]);
    if (Number.isNaN(userId)) return ctx.reply("Invalid user id");
    const roles = args[1]
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    const channel = await ChannelModel.findOne({
      chatId: ctx.session.selectedChannelChatId,
      owners: ctx.from?.id,
    });
    if (!channel) return ctx.reply("Select a channel first with /usechannel.");
    const list: AdminEntry[] = Array.isArray(channel.admins)
      ? (channel.admins as unknown as AdminEntry[])
      : [];
    const existing = list.find((a) => a.userId === userId);
    if (existing) {
      existing.roles = Array.from(new Set([...existing.roles, ...roles]));
    } else {
      list.push({ userId, roles });
      (channel as unknown as { admins: AdminEntry[] }).admins = list;
    }
    await channel.save();
    await ctx.reply("Admin updated.");
  });

  bot.command("rmadmin", async (ctx) => {
    const userIdTxt = ctx.match?.trim();
    if (!userIdTxt) return ctx.reply("Usage: /rmadmin <tgUserId>");
    const userId = Number(userIdTxt);
    if (Number.isNaN(userId)) return ctx.reply("Invalid id");
    const channel = await ChannelModel.findOne({
      chatId: ctx.session.selectedChannelChatId,
      owners: ctx.from?.id,
    });
    if (!channel) return ctx.reply("Select a channel first with /usechannel.");
    const list: AdminEntry[] = Array.isArray(channel.admins)
      ? (channel.admins as unknown as AdminEntry[])
      : [];
    (channel as unknown as { admins: AdminEntry[] }).admins = list.filter(
      (a) => a.userId !== userId,
    );
    await channel.save();
    await ctx.reply("Admin removed.");
  });
}
