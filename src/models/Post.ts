import { Schema, model, InferSchemaType, Types } from 'mongoose';

const InlineButtonSchema = new Schema({
  text: String,
  url: String,
  callbackData: String,
  counterKey: String
}, { _id: false });

const PostSchema = new Schema({
  channel: { type: Types.ObjectId, ref: 'Channel', index: true },
  channelChatId: { type: Number, index: true },
  authorTgId: { type: Number, index: true },
  status: { type: String, enum: ['draft', 'scheduled', 'published', 'deleted'], index: true },
  type: { type: String, enum: ['text', 'photo', 'video', 'poll'], default: 'text' },
  text: String,
  mediaFileId: String,
  poll: {
    question: String,
    options: [String],
    isQuiz: Boolean,
    correctOptionId: Number
  },
  buttons: [InlineButtonSchema],
  scheduledAt: Date,
  recurrence: { cron: String, timezone: String },
  autoDeleteAt: Date,
  publishedMessageId: Number,
  publishedAt: Date,
  viewCount: { type: Number, default: 0 },
  buttonClicks: { type: Map, of: Number },
  meta: { type: Map, of: String }
}, { timestamps: true });

export type Post = InferSchemaType<typeof PostSchema>;
export const PostModel = model('Post', PostSchema);
