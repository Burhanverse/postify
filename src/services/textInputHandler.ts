import type { BotContext } from "../telegram/bot";
import { DraftManager } from "./draftManager";
import { ButtonManager } from "./buttonManager";
import { handleScheduleCommand } from "../commands/scheduling";

export class TextInputHandler {
  /**
   * Handles text input for various modes (draft, button editing, scheduling)
   */
  static async handleTextInput(ctx: BotContext, text: string): Promise<boolean> {
    // Handle button building
    if ((ctx.session as Record<string, unknown>).awaitingButton && ctx.session.draft) {
      await ButtonManager.processButtonInput(ctx, text);
      delete (ctx.session as Record<string, unknown>).awaitingButton;
      return true;
    }

    // Handle button editing
    if (ctx.session.draftEditMode === "button" && ctx.session.draft) {
      await ButtonManager.processButtonEdit(ctx, text);
      return true;
    }

    // Handle custom scheduling input
    if (ctx.session.waitingForScheduleInput) {
      ctx.session.waitingForScheduleInput = false;
      
      // Persist last custom schedule input
      if (ctx.from?.id) {
        const { UserModel } = await import("../models/User");
        UserModel.findOneAndUpdate(
          { tgId: ctx.from.id },
          { $set: { "preferences.lastCustomScheduleInput": text } },
        ).catch(() => {});
      }

      // Process the scheduling input
      await handleScheduleCommand(ctx, text);
      return true;
    }

    // Handle draft text input
    if (ctx.session.draft && !ctx.session.waitingForScheduleInput && !ctx.session.draftLocked) {
      await DraftManager.processTextInput(ctx, text);
      return true;
    }

    return false;
  }

  /**
   * Handles edited text messages
   */
  static async handleEditedText(ctx: BotContext, text: string): Promise<boolean> {
    if (!ctx.session.draft || !ctx.session.initialDraftMessageId || ctx.session.draftLocked) {
      return false;
    }

    if (ctx.editedMessage?.message_id === ctx.session.initialDraftMessageId) {
      await DraftManager.processEditedText(ctx, text);
      return true;
    }

    return false;
  }
}
