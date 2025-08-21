#!/usr/bin/env ts-node
import mongoose from "mongoose";
import { UserBotModel } from "../src/models/UserBot";
import { encrypt } from "../src/utils/crypto";
import { env } from "../src/config/env";

async function run() {
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY not set. Aborting migration to avoid irrecoverable encryption.");
    process.exit(2);
  }
  await mongoose.connect(env.MONGODB_URI);
  const legacy = await UserBotModel.find({ token: { $ne: null }, tokenEncrypted: { $in: [null, undefined, ""] } });
  for (const rec of legacy) {
    try {
      if (!rec.token) continue;
      rec.tokenEncrypted = encrypt(rec.token);
      delete rec.token;
      await rec.save();
      console.log(`Migrated botId=${rec.botId}`);
    } catch (e) {
      console.error(`Failed migrating botId=${rec.botId}:`, e);
    }
  }
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
