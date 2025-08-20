import { BotContext } from "../telegram/bot";
import { ChannelModel } from "../models/Channel";
import { logger } from "../utils/logger";

export function requireChannelAccess() {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Authentication required.");
      return;
    }

    // Check if user has any channels
    const hasChannels = await ChannelModel.exists({ owners: userId });
    if (!hasChannels) {
      await ctx.reply("❌ No channels found. Use /addchannel to link a channel first.");
      return;
    }

    await next();
  };
}

export function requireSelectedChannel() {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Authentication required.");
      return;
    }

    let channelChatId = ctx.session.selectedChannelChatId;
    
    // If no channel selected, try to get user's first channel
    if (!channelChatId) {
      const channel = await ChannelModel.findOne({ owners: userId });
      if (!channel) {
        await ctx.reply("❌ No channels found. Use /addchannel to link a channel first.");
        return;
      }
      channelChatId = channel.chatId;
      ctx.session.selectedChannelChatId = channelChatId;
    }

    // Verify user still has access to the selected channel
    const channel = await ChannelModel.findOne({
      chatId: channelChatId,
      owners: userId
    });

    if (!channel) {
      delete ctx.session.selectedChannelChatId;
      await ctx.reply("❌ Access denied to selected channel. Please select a different channel with /channels");
      return;
    }

    await next();
  };
}

export function requireChannelAdmin(requiredRoles: string[] = []) {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Authentication required.");
      return;
    }

    const channelChatId = ctx.session.selectedChannelChatId;
    if (!channelChatId) {
      await ctx.reply("❌ No channel selected. Use /channels to select a channel first.");
      return;
    }

    const channel = await ChannelModel.findOne({ chatId: channelChatId });
    if (!channel) {
      await ctx.reply("❌ Channel not found.");
      return;
    }

    // Check if user is owner
    if (channel.owners.includes(userId)) {
      await next();
      return;
    }

    // Check if user is admin with required roles
    const admin = channel.admins?.find(admin => admin.userId === userId);
    if (!admin) {
      await ctx.reply("❌ Admin access required for this action.");
      return;
    }

    // If specific roles are required, check them
    if (requiredRoles.length > 0) {
      const hasRequiredRole = requiredRoles.some(role => admin.roles.includes(role));
      if (!hasRequiredRole) {
        await ctx.reply(`❌ Missing required role(s): ${requiredRoles.join(', ')}`);
        return;
      }
    }

    logger.info({
      userId,
      channelId: channel._id,
      roles: admin.roles,
      requiredRoles
    }, "Admin access granted");

    await next();
  };
}

export function requirePostPermission() {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Authentication required.");
      return;
    }

    const channelChatId = ctx.session.selectedChannelChatId;
    if (!channelChatId) {
      await ctx.reply("❌ No channel selected. Use /channels to select a channel first.");
      return;
    }

    const channel = await ChannelModel.findOne({ chatId: channelChatId });
    if (!channel) {
      await ctx.reply("❌ Channel not found.");
      return;
    }

    // Check bot permissions in the channel
    if (!channel.permissions?.canPost) {
      await ctx.reply("❌ Bot doesn't have posting permissions in this channel. Please grant admin rights to the bot.");
      return;
    }

    // Check if user has access (owner or admin)
    const isOwner = channel.owners.includes(userId);
    const isAdmin = channel.admins?.some(admin => 
      admin.userId === userId && 
      (admin.roles.includes('editor') || admin.roles.includes('scheduler'))
    );

    if (!isOwner && !isAdmin) {
      await ctx.reply("❌ You don't have permission to create posts in this channel.");
      return;
    }

    await next();
  };
}

export async function validateBotPermissions(channelChatId: number): Promise<{
  valid: boolean;
  message?: string;
}> {
  try {
    const channel = await ChannelModel.findOne({ chatId: channelChatId });
    if (!channel) {
      return { valid: false, message: "Channel not found in database" };
    }

    // Here you could add actual bot permission checks with Telegram API
    // For now, we rely on stored permissions
    if (!channel.permissions?.canPost) {
      return { 
        valid: false, 
        message: "Bot lacks posting permissions. Please ensure the bot is an admin in the channel." 
      };
    }

    return { valid: true };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      channelChatId
    }, "Failed to validate bot permissions");
    
    return { 
      valid: false, 
      message: "Failed to validate permissions. Please try again." 
    };
  }
}
