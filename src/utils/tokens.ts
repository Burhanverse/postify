export function validateBotTokenFormat(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{35,}$/.test(token.trim());
}
