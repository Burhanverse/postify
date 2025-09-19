import type { Message, PhotoSize, Video, Animation } from "grammy/types";
import type { BotContext } from "../telegram/bot";
import { DraftManager } from "./draftManager";

export class MediaHandler {
  /**
   * Processes photo messages for drafts
   */
  static async handlePhotoMessage(
    ctx: BotContext,
    message: Message,
  ): Promise<boolean> {
    if (!ctx.session.draft || ctx.session.draftLocked) return false;

    const photo = this.extractPhoto(message);
    if (!photo) return false;

    const caption = this.extractCaption(message);
    await DraftManager.processMediaInput(ctx, "photo", photo.file_id, caption);
    return true;
  }

  /**
   * Processes video messages for drafts
   */
  static async handleVideoMessage(
    ctx: BotContext,
    message: Message,
  ): Promise<boolean> {
    if (!ctx.session.draft || ctx.session.draftLocked) return false;

    const video = this.extractVideo(message);
    if (!video) return false;

    const caption = this.extractCaption(message);
    await DraftManager.processMediaInput(ctx, "video", video.file_id, caption);
    return true;
  }

  /**
   * Processes GIF/animation messages for drafts
   */
  static async handleAnimationMessage(
    ctx: BotContext,
    message: Message,
  ): Promise<boolean> {
    if (!ctx.session.draft || ctx.session.draftLocked) return false;

    const animation = this.extractAnimation(message);
    if (!animation) return false;

    const caption = this.extractCaption(message);
    await DraftManager.processMediaInput(ctx, "gif", animation.file_id, caption);
    return true;
  }

  /**
   * Safely extracts photo from message
   */
  private static extractPhoto(message: Message): PhotoSize | undefined {
    if (!this.hasPhotos(message)) return undefined;
    return message.photo.at(-1);
  }

  /**
   * Safely extracts video from message
   */
  private static extractVideo(message: Message): Video | undefined {
    if (!this.hasVideo(message)) return undefined;
    return message.video;
  }

  /**
   * Safely extracts animation/gif from message
   */
  private static extractAnimation(message: Message): Animation | undefined {
    if (!this.hasAnimation(message)) return undefined;
    return message.animation;
  }

  /**
   * Safely extracts caption from message
   */
  private static extractCaption(message: Message): string | undefined {
    return (message as Partial<{ caption: string }>).caption;
  }

  /**
   * Type guard for photo messages
   */
  private static hasPhotos(
    message: Message,
  ): message is Message & { photo: PhotoSize[] } {
    if (!("photo" in message)) return false;
    const candidate = (message as { photo?: unknown }).photo;
    return Array.isArray(candidate);
  }

  /**
   * Type guard for video messages
   */
  private static hasVideo(
    message: Message,
  ): message is Message & { video: Video } {
    if (!("video" in message)) return false;
    const candidate = (message as { video?: unknown }).video;
    return typeof candidate === "object" && candidate !== null;
  }

  /**
   * Type guard for animation/gif messages
   */
  private static hasAnimation(
    message: Message,
  ): message is Message & { animation: Animation } {
    if (!("animation" in message)) return false;
    const candidate = (message as { animation?: unknown }).animation;
    return typeof candidate === "object" && candidate !== null;
  }
}
