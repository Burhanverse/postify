import { Schema, model, InferSchemaType } from "mongoose";

const UserBotSchema = new Schema(
  {
    ownerTgId: { type: Number, index: true, required: true },
    botId: { type: Number, index: true, unique: true, required: true },
    username: { type: String, index: true },
    token: { type: String, required: false }, // legacy field
    tokenEncrypted: { type: String },
    tokenLastFour: { type: String },
    status: {
      type: String,
      enum: ["active", "disabled", "error"],
      default: "active",
      index: true,
    },
    lastError: String,
    lastSeenAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type UserBot = InferSchemaType<typeof UserBotSchema>;
export const UserBotModel = model("UserBot", UserBotSchema);
