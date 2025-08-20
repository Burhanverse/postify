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
    // User preferences persisted across sessions
    preferences: {
      timezone: { type: String, default: "UTC" }, // IANA timezone string
      lastSchedulePreset: { type: String }, // e.g., 'in 1h', 'tomorrow 09:00'
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
  }
};
export const UserModel = model("User", UserSchema);
