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
    buttons: [InlineButtonSchema],
    scheduledAt: Date,
    recurrence: { cron: String, timezone: String },
    publishedMessageId: Number,
    publishedAt: Date,
    meta: { type: Map, of: String },
  },
  { timestamps: true },
);

export type Post = InferSchemaType<typeof PostSchema>;
export const PostModel = model("Post", PostSchema);
