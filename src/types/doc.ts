import type { HydratedDocument, Types } from "mongoose";
import type { Post } from "../models/Post";

// Post document with object id string helper
export type PostDoc = HydratedDocument<Post> & { _id: Types.ObjectId };
export interface ChannelAdminEntry {
  userId: number;
  roles: string[];
}
