import { UserModel } from "../models/User";
import { BotContext } from "../telegram/bot";

export async function userMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
) {
  const from = ctx.from;
  if (from) {
    await UserModel.findOneAndUpdate(
      { tgId: from.id },
      {
        $set: {
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          languageCode: from.language_code,
        },
      },
      { upsert: true },
    );
  }
  return next();
}
