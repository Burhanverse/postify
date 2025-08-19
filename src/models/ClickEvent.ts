import { Schema, model, InferSchemaType } from "mongoose";

const ClickEventSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: "Post", index: true },
    channel: { type: Schema.Types.ObjectId, ref: "Channel", index: true },
    userTgId: { type: Number, index: true },
    buttonKey: { type: String, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type ClickEvent = InferSchemaType<typeof ClickEventSchema>;
export const ClickEventModel = model("ClickEvent", ClickEventSchema);
