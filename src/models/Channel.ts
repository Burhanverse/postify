import { Schema, model, InferSchemaType } from "mongoose";

const ChannelSchema = new Schema(
  {
    chatId: { type: Number, index: true, unique: true, required: true },
    title: String,
    username: String, // public handle
    type: { type: String },
    inviteLink: String,
    owners: [{ type: Number }], // tg user ids with owner role
    admins: [{ userId: Number, roles: [String] }], // roles: owner, editor, scheduler, analyst
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type Channel = InferSchemaType<typeof ChannelSchema>;
export const ChannelModel = model("Channel", ChannelSchema);
