import { connectDb } from "./services/db";
import { initAgenda, shutdownAgenda } from "./services/agenda";
import { launchBot, stopBot } from "./telegram/bot";
import {
  loadAllUserBotsOnStartup,
  stopAllUserBots,
} from "./services/userBotRegistry";
import { logger } from "./utils/logger";
import { env } from "./config/env";

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring signal");
    return;
  }
  
  isShuttingDown = true;
  logger.info({ signal }, "Received shutdown signal, starting graceful shutdown");

  try {
    await stopAllUserBots();
    
    // Stop the main bot
    await stopBot();
    
    // Stop agenda scheduler
    await shutdownAgenda();
    
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during graceful shutdown");
    process.exit(1);
  }
}

// Setup signal handlers for graceful shutdown
function setupSignalHandlers() {
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle unexpected exits
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    gracefulShutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise }, 'Unhandled rejection');
    gracefulShutdown('unhandledRejection');
  });
}

async function main() {
  setupSignalHandlers();
  
  await connectDb();
  await initAgenda();
  if (/ABCDEF|YOUR_TOKEN|123456:ABC/i.test(env.BOT_TOKEN)) {
    logger.warn(
      "BOT_TOKEN appears to be a placeholder. Skipping bot start. Set a real token to run the bot.",
    );
  } else {
    launchBot();
    await loadAllUserBotsOnStartup();
    
    logger.info("Application started successfully. Press Ctrl+C to stop gracefully.");
  }
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  gracefulShutdown('startup-error');
});
