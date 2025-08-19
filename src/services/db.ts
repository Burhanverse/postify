import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export async function connectDb() {
  const uri = env.MONGODB_URI;
  await mongoose.connect(uri, { dbName: env.DB_NAME, autoIndex: true });
  logger.info({ db: env.DB_NAME }, "MongoDB connected");
}
