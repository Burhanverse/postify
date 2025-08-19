import { Schema, model, Types, InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    tgId: { type: Number, index: true, unique: true, required: true },
    username: String,
    firstName: String,
    lastName: String,
    languageCode: String,
    roles: [{ type: String }], // global roles maybe
    channels: [{ type: Types.ObjectId, ref: "Channel" }],
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type User = InferSchemaType<typeof UserSchema>;
export const UserModel = model("User", UserSchema);
