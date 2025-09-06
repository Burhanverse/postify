import {
  Schema,
  model,
  InferSchemaType,
  HydratedDocument,
  Types,
} from "mongoose";

const ChannelSchema = new Schema(
  {
    chatId: { type: Number, index: true, required: true }, // Remove unique constraint
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
ChannelSchema.index({ chatId: 1, botId: 1 }, { unique: true }); // Compound unique index

export type Channel = InferSchemaType<typeof ChannelSchema>;
export type ChannelDoc = HydratedDocument<Channel> & { _id: Types.ObjectId };
export const ChannelModel = model("Channel", ChannelSchema);
