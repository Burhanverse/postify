import { Schema, model, InferSchemaType } from "mongoose";

const ChannelSchema = new Schema(
  {
    chatId: { type: Number, index: true, unique: true, required: true },
    title: String,
    username: String,
    type: { type: String },
    inviteLink: String,
    owners: [{ type: Number }],
    admins: [{ userId: Number, roles: [String] }],
    permissions: {
      canPost: Boolean,
      canEdit: Boolean,
      canDelete: Boolean,
    },
    botId: { type: Number, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

ChannelSchema.index({ username: 1 });

export type Channel = InferSchemaType<typeof ChannelSchema>;
export const ChannelModel = model("Channel", ChannelSchema);
