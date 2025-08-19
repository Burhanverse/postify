import { connectDb } from './services/db.js';
import { initAgenda } from './services/agenda.js';
import { launchBot } from './telegram/bot.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';

async function main() {
  await connectDb();
  await initAgenda();
  if (/ABCDEF|YOUR_TOKEN|123456:ABC/i.test(env.BOT_TOKEN)) {
    logger.warn('BOT_TOKEN appears to be a placeholder. Skipping bot start. Set a real token to run the bot.');
  } else {
    launchBot();
  }
}

main().catch(err => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
