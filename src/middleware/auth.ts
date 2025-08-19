// Placeholder for role-based access control middleware
import { BotContext } from '../telegram/bot.js';

export function requireRole(role: string) {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    // TODO load channel & user roles from db and check
    return next();
  };
}
