import Agenda, { Job } from "agenda";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { PostModel } from "../models/Post";
// Import publisher (ensure extension for ESM resolution)
import { publishPost, deletePublishedPost } from "./publisher";
import { DateTime } from "luxon";
// (Cron validation removed with analytics cleanup; rely on Agenda to handle schedule format)

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
      if (post.autoDeleteAt) {
        await agenda.schedule(post.autoDeleteAt, "auto_delete_post", {
          postId,
        });
      }
    } catch (err) {
      logger.error({ err }, "Failed to publish post");
    }
  });

  agenda.define("auto_delete_post", async (job: Job) => {
    const { postId } = job.attrs.data as { postId: string };
    await deletePublishedPost(postId);
    logger.info({ postId }, "Auto delete executed");
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

export async function scheduleRecurring(
  postId: string,
  cron: string,
  timezone: string,
) {
  await agenda.every(cron, "publish_post", { postId }, { timezone });
}

export async function listScheduled(limit = 20) {
  return agenda.jobs(
    { name: "publish_post", nextRunAt: { $ne: null } },
    { nextRunAt: 1 },
    limit,
  );
}
