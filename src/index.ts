import { connectDb } from './services/db.js';
import { initAgenda } from './services/agenda.js';
import { launchBot } from './telegram/bot.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb();
  await initAgenda();
  launchBot();
}

main().catch(err => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
