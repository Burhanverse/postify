import { Schema, model, Types, InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    tgId: { type: Number, index: true, unique: true, required: true },
    username: String,
    firstName: String,
    lastName: String,
    languageCode: String,
    roles: [{ type: String }],
    channels: [{ type: Types.ObjectId, ref: "Channel" }],
    preferences: {
      timezone: { type: String, default: "UTC" },
      lastSchedulePreset: { type: String },
      lastCustomScheduleInput: { type: String },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type User = InferSchemaType<typeof UserSchema> & {
  preferences?: {
    timezone?: string;
    lastSchedulePreset?: string;
    lastCustomScheduleInput?: string;
  };
};
export const UserModel = model("User", UserSchema);
