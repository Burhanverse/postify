import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export async function connectDb() {
  const uri = env.MONGODB_URI;
  await mongoose.connect(uri, { dbName: env.DB_NAME, autoIndex: true });
  logger.info({ db: env.DB_NAME }, "MongoDB connected");
}
