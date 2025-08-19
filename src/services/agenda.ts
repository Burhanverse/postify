import Agenda, { Job } from "agenda";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { PostModel } from "../models/Post.js";
import { publishPost } from "./publisher.js";
import { DateTime } from "luxon";

let agenda: Agenda;

export function getAgenda() {
  return agenda;
}

export async function initAgenda() {
  agenda = new Agenda({ db: { address: env.MONGODB_URI, collection: "jobs" } });

  agenda.define("publish_post", async (job: Job) => {
    const { postId } = job.attrs.data as { postId: string };
    const post = await PostModel.findById(postId);
    if (!post) return;
    try {
      await publishPost(post);
    } catch (err) {
      logger.error({ err }, "Failed to publish post");
    }
  });

  agenda.define("auto_delete_post", async (job: Job) => {
    const { postId } = job.attrs.data as { postId: string };
    // TODO implement deletion via Telegram API
    logger.info({ postId }, "Auto delete placeholder");
  });

  await agenda.start();
  logger.info("Agenda started");
}

export async function schedulePost(
  postId: string,
  date: Date,
  timezone: string,
) {
  const dt = DateTime.fromJSDate(date).setZone(timezone);
  await agenda.schedule(dt.toJSDate(), "publish_post", { postId });
}
