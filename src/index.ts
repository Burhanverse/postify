import { connectDb } from "./services/db";
import { initAgenda } from "./services/agenda";
import { launchBot } from "./telegram/bot";
import { logger } from "./utils/logger";
import { env } from "./config/env";
import { startHttpServer } from "./server";

async function main() {
  await connectDb();
  await initAgenda();
  // Start lightweight HTTP server for health/docs endpoints (needed for Render)
  startHttpServer();
  if (/ABCDEF|YOUR_TOKEN|123456:ABC/i.test(env.BOT_TOKEN)) {
    logger.warn(
      "BOT_TOKEN appears to be a placeholder. Skipping bot start. Set a real token to run the bot.",
    );
  } else {
    launchBot();
  }
}

main().catch((err) => {
  logger.error({ err }, "Fatal error");
  process.exit(1);
});
