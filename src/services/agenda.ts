import Agenda, { Job } from "agenda";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { PostModel } from "../models/Post";
import { ChannelModel } from "../models/Channel";
import { publishPost } from "./publisher";
import { DateTime } from "luxon";
import { Types } from "mongoose";

let agenda: Agenda;

export function getAgenda() {
  return agenda;
}

export async function initAgenda() {
  agenda = new Agenda({
    db: { address: env.MONGODB_URI, collection: "jobs" },
    processEvery: "30 seconds",
    maxConcurrency: 10,
    defaultLockLifetime: 60000,
  });

  // Enhanced job definition with better error handling and logging
  agenda.define(
    "publish_post",
    {
      concurrency: 5,
    },
    async (job: Job) => {
      const { postId, channelId, userId, timezone } = job.attrs.data as {
        postId: string;
        channelId?: string;
        userId?: number;
        timezone?: string;
      };

      const jobLogger = logger.child({
        jobId: job.attrs._id?.toString(),
        postId,
        channelId,
        userId,
      });

      try {
        jobLogger.info("Starting post publication job");

        // Fetch post with validation
        const post = await PostModel.findById(postId);
        if (!post) {
          jobLogger.error("Post not found, marking job as failed");
          throw new Error(`Post ${postId} not found`);
        }

        // Validate post is still scheduled
        if (post.status !== "scheduled") {
          jobLogger.warn(
            `Post ${postId} is not scheduled (status: ${post.status}), skipping`,
          );
          return;
        }

        // Validate channel still exists and user has access
        if (post.channel) {
          const channel = await ChannelModel.findById(post.channel);
          if (!channel) {
            jobLogger.error("Channel not found for post");
            throw new Error(`Channel not found for post ${postId}`);
          }

          if (userId && !channel.owners.includes(userId)) {
            jobLogger.error("User no longer has access to channel");
            throw new Error(
              `User ${userId} no longer has access to channel for post ${postId}`,
            );
          }
        }

        // Publish the post
        await publishPost(post);

        jobLogger.info("Post published successfully");
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        jobLogger.error({ error: errorMessage }, "Failed to publish post");

        // Update post status to indicate failure
        try {
          await PostModel.findByIdAndUpdate(postId, {
            status: "draft", // Reset to draft so user can reschedule
            updatedAt: new Date(),
            meta: new Map([["lastError", errorMessage]]),
          });
        } catch (updateError) {
          jobLogger.error(
            { error: updateError },
            "Failed to update post status after error",
          );
        }

        throw error;
      }
    },
  );

  // Job event handlers for monitoring
  agenda.on("ready", () => {
    logger.info("Agenda connected and ready");
  });

  agenda.on("start", (job) => {
    logger.debug(
      {
        jobId: job.attrs._id?.toString(),
        jobName: job.attrs.name,
        data: job.attrs.data,
      },
      "Job started",
    );
  });

  agenda.on("complete", (job) => {
    logger.debug(
      {
        jobId: job.attrs._id?.toString(),
        jobName: job.attrs.name,
      },
      "Job completed",
    );
  });

  agenda.on("fail", (error, job) => {
    logger.error(
      {
        error: error.message,
        jobId: job.attrs._id?.toString(),
        jobName: job.attrs.name,
        data: job.attrs.data,
      },
      "Job failed",
    );
  });

  await agenda.start();
  logger.info("Agenda started with enhanced configuration");
}

/**
 * @deprecated Use PostScheduler service instead
 * Legacy function for backward compatibility
 */
export async function schedulePost(
  postId: string,
  date: Date,
  timezone: string,
) {
  logger.warn(
    "Using deprecated schedulePost function. Consider using PostScheduler service instead.",
  );

  const dt = DateTime.fromJSDate(date).setZone(timezone);

  // Add validation
  if (dt.toUTC() <= DateTime.utc()) {
    throw new Error("Cannot schedule post in the past");
  }

  const job = await agenda.schedule(dt.toJSDate(), "publish_post", {
    postId,
    timezone,
    scheduledVia: "legacy",
  });

  logger.info(
    {
      postId,
      scheduledAt: dt.toISO(),
      timezone,
      jobId: job.attrs._id?.toString(),
    },
    "Post scheduled via legacy function",
  );

  return job;
}

export async function listScheduled(limit = 20) {
  try {
    const jobs = await agenda.jobs(
      {
        name: "publish_post",
        nextRunAt: { $ne: null },
        disabled: { $ne: true },
      },
      { nextRunAt: 1 },
      limit,
    );

    return jobs.map((job) => ({
      jobId: job.attrs._id?.toString(),
      postId: job.attrs.data?.postId,
      nextRunAt: job.attrs.nextRunAt,
      priority: job.attrs.priority,
      data: job.attrs.data,
    }));
  } catch (error) {
    logger.error({ error }, "Failed to list scheduled jobs");
    return [];
  }
}

/**
 * Cancel all jobs for a specific post
 */
export async function cancelPostJobs(postId: string): Promise<number> {
  try {
    const numRemoved = await agenda.cancel({
      name: "publish_post",
      "data.postId": postId,
    });

    logger.info({ postId, numRemoved }, "Cancelled jobs for post");
    return numRemoved ?? 0;
  } catch (error) {
    logger.error({ error, postId }, "Failed to cancel jobs for post");
    return 0;
  }
}

/**
 * Get statistics about scheduled jobs
 */
export async function getSchedulingStats() {
  try {
    const stats = {
      totalScheduled: (
        await agenda.jobs({
          name: "publish_post",
          nextRunAt: { $ne: null },
          disabled: { $ne: true },
        })
      ).length,

      failedJobs: (
        await agenda.jobs({
          name: "publish_post",
          failedAt: { $ne: null },
          nextRunAt: null,
        })
      ).length,

      completedToday: (
        await agenda.jobs({
          name: "publish_post",
          lastFinishedAt: {
            $gte: DateTime.utc().startOf("day").toJSDate(),
          },
        })
      ).length,
    };

    return stats;
  } catch (error) {
    logger.error({ error }, "Failed to get scheduling stats");
    return {
      totalScheduled: 0,
      failedJobs: 0,
      completedToday: 0,
    };
  }
}

/**
 * Gracefully shutdown agenda
 */
export async function shutdownAgenda(): Promise<void> {
  if (agenda) {
    logger.info("Shutting down Agenda gracefully");
    await agenda.stop();
    logger.info("Agenda stopped");
  }
}
