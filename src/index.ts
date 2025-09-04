import { connectDb } from "./services/db";
import { initAgenda, shutdownAgenda } from "./services/agenda";
import { launchBot, stopBot } from "./telegram/bot";
import {
  loadAllUserBotsOnStartup,
  startUserBotSupervisor,
  stopAllUserBots,
  stopUserBotSupervisor,
} from "./services/userBotRegistry";
import { logger } from "./utils/logger";
import { env } from "./config/env";

// Track if shutdown is in progress to prevent multiple shutdown attempts
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring signal");
    return;
  }
  
  isShuttingDown = true;
  logger.info({ signal }, "Received shutdown signal, starting graceful shutdown");

  try {
    // Stop the supervisor first to prevent it from restarting bots
    stopUserBotSupervisor();
    
    // Stop all personal bots first to avoid Telegram API conflicts
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
  // Handle standard termination signals
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
  // Setup signal handlers early
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
    startUserBotSupervisor();
    
    logger.info("Application started successfully. Press Ctrl+C to stop gracefully.");
  }
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  gracefulShutdown('startup-error');
});
