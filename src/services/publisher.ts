import { PostModel, Post } from '../models/Post.js';
import { logger } from '../utils/logger.js';
import { bot } from '../telegram/bot.js';
import { InlineKeyboard } from 'grammy';
import { ChannelModel } from '../models/Channel.js';

export async function publishPost(post: Post) {
  const channel = await ChannelModel.findById(post.channel);
  if (!channel) return;
  const chatId = channel.chatId;

  const keyboard = new InlineKeyboard();
  post.buttons?.forEach((b: { text?: string | null; url?: string | null; callbackData?: string | null; counterKey?: string | null }) => {
    if (b.url) keyboard.url(b.text || '🔗', b.url);
    else if (b.callbackData) keyboard.text(b.text || '•', `btn:${post.id}:${b.callbackData}`);
  });

  let sent;
  if (post.type === 'photo' && post.mediaFileId) {
    sent = await bot.api.sendPhoto(chatId, post.mediaFileId, { caption: post.text || undefined, reply_markup: keyboard });
  } else if (post.type === 'video' && post.mediaFileId) {
    sent = await bot.api.sendVideo(chatId, post.mediaFileId, { caption: post.text || undefined, reply_markup: keyboard });
  } else if (post.type === 'poll' && post.poll) {
    sent = await bot.api.sendPoll(chatId, post.poll.question || '', post.poll.options || [], { allows_multiple_answers: !post.poll.isQuiz, correct_option_id: post.poll.correctOptionId, is_anonymous: false });
  } else {
    sent = await bot.api.sendMessage(chatId, post.text || '', { reply_markup: keyboard });
  }

  await PostModel.updateOne({ _id: post._id }, { $set: { status: 'published', publishedMessageId: sent.message_id, publishedAt: new Date() } });
  logger.info({ postId: post.id, messageId: sent.message_id }, 'Post published');
}
