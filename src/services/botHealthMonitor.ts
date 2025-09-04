import { logger } from "../utils/logger";
import { cleanupStaleBots, getBotStatus, detectBotConflicts } from "./userBotRegistry";

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startBotHealthMonitor() {
  if (healthCheckInterval) {
    logger.warn("Bot health monitor already running");
    return;
  }

  // Run health check every 5 minutes
  healthCheckInterval = setInterval(
    () => {
      try {
        // Check for potential conflicts first
        detectBotConflicts();
        
        // Then cleanup stale bots
        const cleanedCount = cleanupStaleBots();
        if (cleanedCount > 0) {
          const status = getBotStatus();
          logger.info(
            { cleanedCount, status },
            "Bot health check completed with cleanup",
          );
        } else {
          logger.debug("Bot health check completed - all bots healthy");
        }
      } catch (error) {
        logger.error({ error }, "Error during bot health check");
      }
    },
    5 * 60 * 1000,
  ); // 5 minutes

  logger.info("Bot health monitor started");
}

export function stopBotHealthMonitor() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    logger.info("Bot health monitor stopped");
  }
}
