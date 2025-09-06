import { Schema, model, InferSchemaType, Types } from "mongoose";

const InlineButtonSchema = new Schema(
  {
    text: String,
    url: String,
    callbackData: String,
  },
  { _id: false },
);

const PostSchema = new Schema(
  {
    channel: { type: Types.ObjectId, ref: "Channel", index: true },
    channelChatId: { type: Number, index: true },
    authorTgId: { type: Number, index: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "published"],
      index: true,
    },
    type: { type: String, enum: ["text", "photo", "video"], default: "text" },
    text: String,
    mediaFileId: String,
  // Bot ID that originally captured mediaFileId. Needed to re-upload across bots if required.
  mediaOwnerBotId: Number,
  // Bot ID that must publish this post. Prevents cross-bot publishing.
  publisherBotId: { type: Number, index: true },
    buttons: [InlineButtonSchema],
    scheduledAt: Date,
    publishedMessageId: Number,
    publishedAt: Date,
    pinAfterPosting: { type: Boolean, default: false },
    pinnedAt: Date,
    meta: { type: Map, of: String },
  },
  { timestamps: true },
);

export type Post = InferSchemaType<typeof PostSchema>;
export const PostModel = model("Post", PostSchema);
