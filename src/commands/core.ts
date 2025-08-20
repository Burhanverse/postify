import { Bot } from "grammy";
import { BotContext } from "../telegram/bot";
import { logger } from "../utils/logger";
import { ChannelModel } from "../models/Channel";

export function registerCoreCommands(bot: Bot<BotContext>) {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to Postify Bot! Use /addchannel to connect a channel.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "📝 **COMMANDS**\n" +
        "/addchannel - connect a channel\n" +
        "/channels - list your channels\n" +
        "/usechannel <chatId> - set active channel (affects /admins, /addadmin, /rmadmin, /queue)\n" +
        "/checkchannels - verify bot posting permissions for all linked channels\n" +
        "/newpost - create a draft (with Send Now option)\n" +
        "/addbutton - add a button to draft\n" +
        "/preview - preview current draft\n" +
        "/schedule [in <min>|ISO] - schedule draft\n" +
        "/queue - list scheduled posts\n" +
        "/listposts - list all posts\n" +
        "/admins - list admins\n" +
        "/addadmin <id> <roles> - add/update admin\n" +
        "/rmadmin <id> - remove admin\n\n" +
        "✨ **TEXT FORMATTING**\n" +
        "<b>bold text</b>\n" +
        "<i>italic text</i>\n" +
        "<code>inline code</code>\n" +
        "<pre>code block</pre>\n" +
        "<blockquote>quoted text</blockquote>",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("addchannel", async (ctx) => {
    await ctx.reply(
      "Send @username of a public channel or forward **any** message from the private channel where the bot is added as admin.",
      { parse_mode: "Markdown" },
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
        const chatShape = chat as { id: number; type: string; title?: string };
        title = chatShape.title;
        type = chat.type;
        if ((chat as { type: string }).type === "channel") {
        }
      } catch (err) {
        logger.warn({ 
          error: err instanceof Error ? err.message : String(err),
          username,
          userId: ctx.from?.id 
        }, "Failed to get chat information");
        await ctx.reply(
          "Cannot access that channel. Ensure the bot was added as admin.",
        );
        return;
      }
    } else {
      return next();
    }

    if (!chatId) {
      await ctx.reply(
        "Failed to resolve channel. Try forwarding a message from it.",
      );
      return;
    }

    let member;
    try {
      member = await ctx.api.getChatMember(chatId, ctx.me.id);
    } catch (err) {
      logger.warn({ 
        error: err instanceof Error ? err.message : String(err),
        chatId,
        userId: ctx.from?.id 
      }, "Failed to check bot permissions in channel");
      await ctx.reply(
        "I can't access that channel member list. Add me as admin first.",
      );
      return;
    }
    const m = member as { can_post_messages?: boolean; status: string };
    const canPost =
      m.can_post_messages ??
      (m.status === "administrator" || m.status === "creator");
    if (!canPost) {
      await ctx.reply(
        "I need permission to post in that channel. Grant posting rights and retry.",
      );
      return;
    }

    await ChannelModel.findOneAndUpdate(
      { chatId },
      {
        $set: {
          chatId,
          username,
          title,
          type,
          inviteLink,
          permissions: { canPost: true, canEdit: true, canDelete: true },
        },
        $addToSet: { owners: ctx.from?.id },
      },
      { upsert: true },
    );

    delete ctx.session.awaitingChannelRef;
    logger.info({ 
      userId: ctx.from?.id,
      chatId,
      title,
      username,
      type 
    }, "Channel linked successfully");
    await ctx.reply(`Channel linked: ${title || username || chatId}`);
  });

  bot.command("checkchannels", async (ctx) => {
    const channels = await ChannelModel.find({ owners: ctx.from?.id });
    if (!channels.length) {
      await ctx.reply("No channels linked. Use /addchannel to link a channel.");
      return;
    }

    let response = "🔍 **Channel Status Check:**\n\n";
    const me = await ctx.api.getMe();

    for (const channel of channels) {
      try {
        const member = await ctx.api.getChatMember(channel.chatId, me.id);
        const canPost =
          member.status === "administrator" || member.status === "creator";

        const status = canPost ? "✅ Working" : "⚠️ No posting permission";
        const channelName =
          channel.title || channel.username || channel.chatId.toString();

        response += `**${channelName}**\n`;
        response += `Status: ${status}\n`;
        response += `ID: \`${channel.chatId}\`\n\n`;
      } catch (error) {
        const channelName =
          channel.title || channel.username || channel.chatId.toString();
        response += `**${channelName}**\n`;
        response += `Status: ❌ Bot removed or no access\n`;
        response += `ID: \`${channel.chatId}\`\n\n`;
      }
    }

    response += "💡 *Use /addchannel to re-add problematic channels*";
    await ctx.reply(response, { parse_mode: "Markdown" });
  });

  bot.api
    .setMyCommands([
      { command: "addchannel", description: "Connect a channel" },
      { command: "newpost", description: "Create a draft" },
      { command: "channels", description: "List connected channels" },
      { command: "addbutton", description: "Add button to draft" },
      { command: "preview", description: "Preview draft" },
      { command: "schedule", description: "Schedule last draft" },
      { command: "queue", description: "List scheduled posts" },
      { command: "listposts", description: "List all posts" },
      { command: "usechannel", description: "Select active channel (admin ops)" },
      { command: "checkchannels", description: "Verify channel permissions" },
      { command: "admins", description: "Manage channel admins" },
      { command: "addadmin", description: "Grant roles to user" },
      { command: "rmadmin", description: "Remove admin user" },
    ])
    .catch((err) => logger.error({ err }, "setMyCommands failed"));
}
