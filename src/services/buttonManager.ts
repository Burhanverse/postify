import { InlineKeyboard } from "grammy";
import type { BotContext } from "../telegram/bot";
import { DraftManager, type DraftButton } from "./draftManager";

export class ButtonManager {
  /**
   * Processes button input text and adds buttons to draft
   */
  static async processButtonInput(ctx: BotContext, text: string): Promise<void> {
    if (!ctx.session.draft) {
      await ctx.reply("Start a draft first with /newpost");
      return;
    }

    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let addedButtons: string[] = [];
    let errors: string[] = [];
    
    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 2) {
        const buttonText = parts[0];
        const target = parts.slice(1).join("|");
        
        if (/^https?:\/\//i.test(target)) {
          ctx.session.draft.buttons?.push({ text: buttonText, url: target });
          addedButtons.push(`"${buttonText}" (URL)`);
        } else if (/^CALLBACK:/i.test(target)) {
          const key = target.split(":")[1];
          ctx.session.draft.buttons?.push({ text: buttonText, callbackData: key });
          addedButtons.push(`"${buttonText}" (Callback)`);
        } else {
          errors.push(`Invalid target for "${buttonText}": ${target}`);
        }
      } else {
        errors.push(`Invalid format: ${line}`);
      }
    }
    
    let responseMessage = "";
    
    if (addedButtons.length > 0) {
      responseMessage += `**${addedButtons.length} button(s) added successfully**\n\n`;
      responseMessage += addedButtons.map(btn => `• ${btn}`).join('\n');
    }
    
    if (errors.length > 0) {
      if (responseMessage) responseMessage += "\n\n";
      responseMessage += `**${errors.length} error(s) encountered:**\n\n`;
      responseMessage += errors.map(err => `• ${err}`).join('\n');
      responseMessage += "\n\n**Format:**\n";
      responseMessage += "• `Button Text | https://example.com` for URL buttons\n";
      responseMessage += "• `Button Text | CALLBACK:key` for callback buttons";
    }
    
    if (!responseMessage) {
      responseMessage = "**No valid buttons found**\n\nPlease use the correct format:\n";
      responseMessage += "• `Button Text | https://example.com` for URL buttons\n";
      responseMessage += "• `Button Text | CALLBACK:key` for callback buttons";
    }
    
    await ctx.reply(responseMessage, { parse_mode: "Markdown" });
  }

  /**
   * Shows button management interface
   */
  static async showButtonManagement(ctx: BotContext): Promise<void> {
    const buttons = ctx.session.draft?.buttons || [];
    if (!buttons.length) {
      await ctx.reply(
        "**No buttons found**\n\nAdd buttons first using the Add Button option or /addbutton command.",
        { parse_mode: "Markdown" },
      );
      return;
    }
    
    const kbList = new InlineKeyboard();
    buttons.forEach((b, i) => {
      kbList.text(`${i + 1}. ${b.text}`, `draft:showbtn:${i}`).row();
    });
    kbList.text("Back", "draft:back");
    
    await ctx.editMessageReplyMarkup({ reply_markup: kbList });
  }

  /**
   * Shows individual button management options
   */
  static async showButtonDetails(ctx: BotContext, index: number): Promise<void> {
    const btn = ctx.session.draft?.buttons?.[index];
    if (!btn) {
      await ctx.reply(
        "**Button not found**\n\nThe selected button no longer exists.",
        { parse_mode: "Markdown" },
      );
      return;
    }
    
    const kbBtn = new InlineKeyboard()
      .text("Edit", `draft:editbtn:${index}`)
      .text("Remove", `draft:delbtn:${index}`)
      .row()
      .text("Buttons", "draft:managebtns");
    
    await ctx.editMessageReplyMarkup({ reply_markup: kbBtn });
  }

  /**
   * Removes a button from the draft
   */
  static async removeButton(ctx: BotContext, index: number): Promise<void> {
    const deletedButton = ctx.session.draft?.buttons?.[index];
    if (ctx.session.draft?.buttons) {
      ctx.session.draft.buttons.splice(index, 1);
    }
    
    await ctx.reply(
      `**Button removed**\n\nDeleted: "${deletedButton?.text || "Unknown button"}"`,
      { parse_mode: "Markdown" },
    );
    await DraftManager.renderDraftPreview(ctx);
  }

  /**
   * Starts button editing mode
   */
  static async startButtonEdit(ctx: BotContext, index: number): Promise<void> {
    const btn = ctx.session.draft?.buttons?.[index];
    ctx.session.draftEditMode = "button";
    (ctx.session as Record<string, unknown>).editingButtonIndex = index;
    
    await ctx.reply(
      `**Edit Button: "${btn?.text || "Unknown"}"**\n\n` +
        "Send the new button in this format:\n" +
        "• `Button Text | https://example.com` for URL buttons\n" +
        "• `Button Text | CALLBACK:custom_key` for callback buttons\n\n" +
        `**Current:** ${btn?.url ? `URL button to ${btn.url}` : btn?.callbackData ? `Callback button (${btn.callbackData})` : 'Unknown type'}`,
      { parse_mode: "Markdown" },
    );
  }

  /**
   * Processes button edit input
   */
  static async processButtonEdit(ctx: BotContext, text: string): Promise<void> {
    const parts = text.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      await ctx.reply(
        "**Invalid format**\n\nUse: `Button Text | URL` or `Button Text | CALLBACK:key`",
        { parse_mode: "Markdown" },
      );
      return;
    }

    const buttonText = parts[0];
    const target = parts.slice(1).join("|");
    const idx = (ctx.session as Record<string, unknown>).editingButtonIndex as number | undefined;
    
    let newBtn: DraftButton | undefined;
    
    if (/^https?:\/\//i.test(target)) {
      newBtn = { text: buttonText, url: target };
    } else if (/^CALLBACK:/i.test(target)) {
      newBtn = { text: buttonText, callbackData: target.split(":")[1] };
    }
    
    if (!newBtn) {
      await ctx.reply("Unrecognized target. Use URL or CALLBACK:key");
      return;
    }
    
    if (
      Number.isInteger(idx) &&
      typeof idx === "number" &&
      ctx.session.draft?.buttons &&
      idx >= 0 &&
      idx < ctx.session.draft.buttons.length
    ) {
      ctx.session.draft.buttons[idx] = newBtn;
      await ctx.reply(
        `**Button updated**\n\nUpdated: "${newBtn.text}"`,
        { parse_mode: "Markdown" },
      );
    } else {
      ctx.session.draft?.buttons?.push(newBtn);
      await ctx.reply(`**Button added**\n\nAdded: "${newBtn.text}"`, {
        parse_mode: "Markdown",
      });
    }
    
    ctx.session.draftEditMode = null;
    delete (ctx.session as Record<string, unknown>).editingButtonIndex;
    await DraftManager.renderDraftPreview(ctx);
  }

  /**
   * Shows add button instructions
   */
  static async showAddButtonInstructions(ctx: BotContext): Promise<void> {
    await ctx.reply(
      "**Add Button(s)**\n\n" +
        "Send your button(s) in this format:\n" +
        "• `Button Text | https://example.com` for URL buttons\n" +
        "• `Button Text | CALLBACK:custom_key` for callback buttons\n\n" +
        "**Single button:** `Visit Website | https://google.com`\n" +
        "**Multiple buttons (one per line):**\n" +
        "```\n" +
        "Visit Website | https://google.com\n" +
        "Contact Us | https://contact.example.com\n" +
        "Call Now | CALLBACK:call_action\n" +
        "```",
      { parse_mode: "Markdown" },
    );
    (ctx.session as Record<string, unknown>).awaitingButton = true;
  }
}
