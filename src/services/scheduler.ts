import { DateTime } from "luxon";
import { Types } from "mongoose";
import { logger } from "../utils/logger";
import { PostModel } from "../models/Post";
import { ChannelModel } from "../models/Channel";
import { getAgenda } from "./agenda";

export interface ScheduleRequest {
  postId: string;
  scheduledAt: Date;
  timezone: string;
  channelId: string;
  userId: number;
  priority?: 'low' | 'normal' | 'high';
}

export interface ScheduleValidationResult {
  valid: boolean;
  error?: string;
  parsedDate?: DateTime;
}

export interface ScheduleConflictCheck {
  hasConflict: boolean;
  conflictingPosts?: string[];
  recommendation?: string;
}

/**
 * Comprehensive scheduling service for post management
 * Handles validation, conflict detection, and reliable job scheduling
 */
export class PostScheduler {
  private static instance: PostScheduler;
  
  // Maximum posts per channel per hour to prevent spam
  private static readonly MAX_POSTS_PER_HOUR = 10;
  
  // Minimum interval between posts in the same channel (in minutes)
  private static readonly MIN_POST_INTERVAL = 3;
  
  // Maximum scheduling window (6 months ahead)
  private static readonly MAX_SCHEDULE_DAYS = 180;

  private constructor() {}

  public static getInstance(): PostScheduler {
    if (!PostScheduler.instance) {
      PostScheduler.instance = new PostScheduler();
    }
    return PostScheduler.instance;
  }

  /**
   * Parse and validate scheduling input from user
   */
  public parseScheduleInput(input: string, timezone: string = 'UTC'): ScheduleValidationResult {
    const trimmed = input.trim().toLowerCase();
    
    try {
      // Handle relative time format: "in X minutes/hours/days"
      const relativeMatch = trimmed.match(/^in\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)?\s*$/i);
      if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]);
        const unit = (relativeMatch[2] || 'm').toLowerCase();
        
        let duration: Record<string, number>;
        
        if (unit.startsWith('m')) {
          if (amount < 1 || amount > 10080) { // 1 week in minutes
            return { valid: false, error: "Minutes must be between 1 and 10,080 (1 week)" };
          }
          duration = { minutes: amount };
        } else if (unit.startsWith('h')) {
          if (amount < 1 || amount > 168) { // 1 week in hours
            return { valid: false, error: "Hours must be between 1 and 168 (1 week)" };
          }
          duration = { hours: amount };
        } else if (unit.startsWith('d')) {
          if (amount < 1 || amount > PostScheduler.MAX_SCHEDULE_DAYS) {
            return { valid: false, error: `Days must be between 1 and ${PostScheduler.MAX_SCHEDULE_DAYS}` };
          }
          duration = { days: amount };
        } else {
          return { valid: false, error: "Invalid time unit. Use 'm', 'h', or 'd'" };
        }
        
        const scheduledDate = DateTime.utc().plus(duration).setZone(timezone);
        return { valid: true, parsedDate: scheduledDate };
      }

      // Handle natural language formats
      const naturalLanguageResult = this.parseNaturalLanguage(trimmed, timezone);
      if (naturalLanguageResult.valid) {
        return naturalLanguageResult;
      }

      // Handle absolute date/time formats
      let parsedDate: DateTime;

      // Try ISO format first
      if (input.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{3})?Z?$/)) {
        parsedDate = DateTime.fromISO(input, { zone: timezone });
      }
      // Try common date formats
      else if (input.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/)) {
        parsedDate = DateTime.fromFormat(input, 'yyyy-MM-dd HH:mm:ss', { zone: timezone });
        if (!parsedDate.isValid) {
          parsedDate = DateTime.fromFormat(input, 'yyyy-MM-dd HH:mm', { zone: timezone });
        }
      }
      // Try short format
      else if (input.match(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/)) {
        parsedDate = DateTime.fromFormat(input, 'MM/dd/yyyy HH:mm', { zone: timezone });
      }
      // Try just time (today)
      else if (input.match(/^\d{2}:\d{2}(:\d{2})?$/)) {
        const now = DateTime.now().setZone(timezone);
        parsedDate = DateTime.fromFormat(`${now.toFormat('yyyy-MM-dd')} ${input}`, 'yyyy-MM-dd HH:mm:ss', { zone: timezone });
        if (!parsedDate.isValid) {
          parsedDate = DateTime.fromFormat(`${now.toFormat('yyyy-MM-dd')} ${input}`, 'yyyy-MM-dd HH:mm', { zone: timezone });
        }
        // If the time is in the past today, schedule for tomorrow
        if (parsedDate <= now) {
          parsedDate = parsedDate.plus({ days: 1 });
        }
      }
      else {
        // Try to parse as natural language using luxon
        parsedDate = DateTime.fromJSDate(new Date(input), { zone: timezone });
      }

      if (!parsedDate.isValid) {
        return { 
          valid: false, 
          error: `Invalid date format. Use:\n• "in 30m" or "in 2h" or "in 1d"\n• "tomorrow 09:00" or "next monday 14:30"\n• "2024-12-25 14:30"\n• "14:30" (today/tomorrow)\n• "12/25/2024 14:30"` 
        };
      }

      // Validate future date
      const now = DateTime.utc();
      if (parsedDate.toUTC() <= now.plus({ minutes: 1 })) {
        return { valid: false, error: "Scheduled time must be at least 1 minute in the future" };
      }

      // Validate not too far in future
      const maxDate = now.plus({ days: PostScheduler.MAX_SCHEDULE_DAYS });
      if (parsedDate.toUTC() > maxDate) {
        return { valid: false, error: `Cannot schedule more than ${PostScheduler.MAX_SCHEDULE_DAYS} days in advance` };
      }

      return { valid: true, parsedDate };

    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Error parsing schedule input");
      return { valid: false, error: "Failed to parse date/time. Please check your format." };
    }
  }

  /**
   * Parse natural language time inputs
   */
  private parseNaturalLanguage(input: string, timezone: string): ScheduleValidationResult {
    const now = DateTime.now().setZone(timezone);
    
    try {
      // Handle "tomorrow" with optional time
      const tomorrowMatch = input.match(/^tomorrow(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (tomorrowMatch) {
        let tomorrow = now.plus({ days: 1 });
        
        if (tomorrowMatch[1] && tomorrowMatch[2]) {
          const hour = parseInt(tomorrowMatch[1]);
          const minute = parseInt(tomorrowMatch[2]);
          const second = tomorrowMatch[3] ? parseInt(tomorrowMatch[3]) : 0;
          
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
            return { valid: false, error: "Invalid time format. Use HH:MM or HH:MM:SS (24-hour format)" };
          }
          
          tomorrow = tomorrow.set({ hour, minute, second, millisecond: 0 });
        } else {
          // Default to 9 AM if no time specified
          tomorrow = tomorrow.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
        }
        
        return { valid: true, parsedDate: tomorrow };
      }

      // Handle day names with optional "next" prefix and time
      const dayMatch = input.match(/^(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (dayMatch) {
        const prefix = dayMatch[1]; // "next", "this", or undefined
        const dayName = dayMatch[2];
        const hour = dayMatch[3] ? parseInt(dayMatch[3]) : 9; // Default to 9 AM
        const minute = dayMatch[4] ? parseInt(dayMatch[4]) : 0;
        const second = dayMatch[5] ? parseInt(dayMatch[5]) : 0;
        
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
          return { valid: false, error: "Invalid time format. Use HH:MM or HH:MM:SS (24-hour format)" };
        }
        
        // Map day names to numbers (1 = Monday, 7 = Sunday)
        const dayMapping: Record<string, number> = {
          'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
          'friday': 5, 'saturday': 6, 'sunday': 7
        };
        
        const targetDay = dayMapping[dayName];
        const currentDay = now.weekday;
        
        let targetDate = now.set({ hour, minute, second, millisecond: 0 });
        
        if (prefix === 'next') {
          // Always go to next week
          const daysToAdd = (7 - currentDay) + targetDay;
          targetDate = targetDate.plus({ days: daysToAdd });
        } else {
          // Find the next occurrence of this day
          let daysToAdd = targetDay - currentDay;
          if (daysToAdd <= 0 || (daysToAdd === 0 && targetDate <= now)) {
            daysToAdd += 7; // Go to next week
          }
          targetDate = targetDate.plus({ days: daysToAdd });
        }
        
        return { valid: true, parsedDate: targetDate };
      }

      // Handle "today" with time
      const todayMatch = input.match(/^today\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (todayMatch) {
        const hour = parseInt(todayMatch[1]);
        const minute = parseInt(todayMatch[2]);
        const second = todayMatch[3] ? parseInt(todayMatch[3]) : 0;
        
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
          return { valid: false, error: "Invalid time format. Use HH:MM or HH:MM:SS (24-hour format)" };
        }
        
        const today = now.set({ hour, minute, second, millisecond: 0 });
        
        // If the time has already passed today, error out
        if (today <= now) {
          return { valid: false, error: "That time has already passed today. Use 'tomorrow' or a future time." };
        }
        
        return { valid: true, parsedDate: today };
      }

      return { valid: false, error: "Natural language format not recognized" };
      
    } catch (error) {
      return { valid: false, error: "Failed to parse natural language time" };
    }
  }

  /**
   * Check for scheduling conflicts in the same channel
   */
  public async checkSchedulingConflicts(
    channelId: string, 
    scheduledAt: DateTime,
    excludePostId?: string
  ): Promise<ScheduleConflictCheck> {
    try {
      const channel = await ChannelModel.findById(channelId);
      if (!channel) {
        return { hasConflict: false };
      }

      // Check for posts scheduled too close together
      const intervalStart = scheduledAt.minus({ minutes: PostScheduler.MIN_POST_INTERVAL }).toJSDate();
      const intervalEnd = scheduledAt.plus({ minutes: PostScheduler.MIN_POST_INTERVAL }).toJSDate();

      const conflictQuery: Record<string, unknown> = {
        channel: new Types.ObjectId(channelId),
        status: 'scheduled',
        scheduledAt: {
          $gte: intervalStart,
          $lte: intervalEnd
        }
      };

      if (excludePostId) {
        conflictQuery._id = { $ne: new Types.ObjectId(excludePostId) };
      }

      const nearbyPosts = await PostModel.find(conflictQuery).limit(5);

      if (nearbyPosts.length > 0) {
        const conflictingIds = nearbyPosts.map(p => p._id.toString());
        return {
          hasConflict: true,
          conflictingPosts: conflictingIds,
          recommendation: `Consider scheduling at least ${PostScheduler.MIN_POST_INTERVAL} minutes apart from other posts`
        };
      }

      // Check hourly rate limit
      const hourStart = scheduledAt.startOf('hour').toJSDate();
      const hourEnd = scheduledAt.endOf('hour').toJSDate();

      const hourlyPostsQuery: Record<string, unknown> = {
        channel: new Types.ObjectId(channelId),
        status: 'scheduled',
        scheduledAt: {
          $gte: hourStart,
          $lte: hourEnd
        }
      };

      if (excludePostId) {
        hourlyPostsQuery._id = { $ne: new Types.ObjectId(excludePostId) };
      }

      const hourlyPosts = await PostModel.countDocuments(hourlyPostsQuery);

      if (hourlyPosts >= PostScheduler.MAX_POSTS_PER_HOUR) {
        return {
          hasConflict: true,
          recommendation: `Channel has reached the hourly limit of ${PostScheduler.MAX_POSTS_PER_HOUR} posts. Consider scheduling in a different hour.`
        };
      }

      return { hasConflict: false };

    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : String(error),
        channelId,
        scheduledAt: scheduledAt.toISO()
      }, "Error checking scheduling conflicts");
      
      return { hasConflict: false }; // Continue on error, but log it
    }
  }

  /**
   * Schedule a post with comprehensive validation and conflict checking
   */
  public async schedulePost(request: ScheduleRequest): Promise<{
    success: boolean;
    jobId?: string;
    error?: string;
    warning?: string;
  }> {
    try {
      const { postId, scheduledAt, timezone, channelId, userId, priority = 'normal' } = request;

      // Validate post exists and belongs to user
      const post = await PostModel.findById(postId);
      if (!post) {
        return { success: false, error: "Post not found" };
      }

      if (post.authorTgId !== userId) {
        return { success: false, error: "Unauthorized: Post does not belong to user" };
      }

      // Validate channel exists and user has access
      const channel = await ChannelModel.findById(channelId);
      if (!channel) {
        return { success: false, error: "Channel not found" };
      }

      if (!channel.owners.includes(userId)) {
        return { success: false, error: "Unauthorized: User does not have access to channel" };
      }

      // Check for conflicts
      const conflictCheck = await this.checkSchedulingConflicts(
        channelId, 
        DateTime.fromJSDate(scheduledAt, { zone: timezone }),
        postId
      );

      let warning: string | undefined;
      if (conflictCheck.hasConflict && conflictCheck.recommendation) {
        // For now, we'll allow scheduling with a warning
        // In the future, you might want to block certain conflicts
        warning = conflictCheck.recommendation;
      }

      // Schedule the job using Agenda
      const agenda = getAgenda();
      if (!agenda) {
        return { success: false, error: "Scheduler not initialized" };
      }

      // Create a unique job name to prevent duplicates
      const jobName = `publish_post_${postId}`;
      
      // Cancel any existing job for this post
      await agenda.cancel({ name: "publish_post", "data.postId": postId });

      // Schedule the new job
      const job = await agenda.schedule(scheduledAt, "publish_post", { 
        postId,
        channelId,
        userId,
        priority,
        timezone
      });

      // Update post status and scheduled time
      await PostModel.findByIdAndUpdate(postId, {
        status: 'scheduled',
        scheduledAt: scheduledAt,
        updatedAt: new Date()
      });

      logger.info({
        postId,
        channelId,
        userId,
        scheduledAt: scheduledAt.toISOString(),
        timezone,
        priority,
        jobId: job.attrs._id?.toString()
      }, "Post scheduled successfully");

      return { 
        success: true, 
        jobId: job.attrs._id?.toString(),
        warning 
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        request
      }, "Failed to schedule post");

      return { 
        success: false, 
        error: "Failed to schedule post. Please try again." 
      };
    }
  }

  /**
   * Cancel a scheduled post
   */
  public async cancelScheduledPost(postId: string, userId: number): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Validate post exists and belongs to user
      const post = await PostModel.findById(postId);
      if (!post) {
        return { success: false, error: "Post not found" };
      }

      if (post.authorTgId !== userId) {
        return { success: false, error: "Unauthorized: Post does not belong to user" };
      }

      if (post.status !== 'scheduled') {
        return { success: false, error: "Post is not scheduled" };
      }

      // Cancel the job
      const agenda = getAgenda();
      if (agenda) {
        await agenda.cancel({ name: "publish_post", "data.postId": postId });
      }

      // Update post status
      await PostModel.findByIdAndUpdate(postId, {
        status: 'draft',
        scheduledAt: undefined,
        updatedAt: new Date()
      });

      logger.info({
        postId,
        userId
      }, "Scheduled post cancelled");

      return { success: true };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        postId,
        userId
      }, "Failed to cancel scheduled post");

      return { 
        success: false, 
        error: "Failed to cancel scheduled post. Please try again." 
      };
    }
  }

  /**
   * Reschedule an existing post
   */
  public async reschedulePost(
    postId: string, 
    newScheduledAt: Date, 
    timezone: string,
    userId: number
  ): Promise<{
    success: boolean;
    jobId?: string;
    error?: string;
    warning?: string;
  }> {
    try {
      const post = await PostModel.findById(postId);
      if (!post) {
        return { success: false, error: "Post not found" };
      }

      // Cancel existing schedule
      const cancelResult = await this.cancelScheduledPost(postId, userId);
      if (!cancelResult.success) {
        return cancelResult;
      }

      if (!post.channel) {
        return { success: false, error: "Post channel not found" };
      }

      // Schedule with new time
      return await this.schedulePost({
        postId,
        scheduledAt: newScheduledAt,
        timezone,
        channelId: post.channel.toString(),
        userId
      });

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        postId,
        userId
      }, "Failed to reschedule post");

      return { 
        success: false, 
        error: "Failed to reschedule post. Please try again." 
      };
    }
  }

  /**
   * Get scheduled posts for a user/channel with pagination
   */
  public async getScheduledPosts(options: {
    userId: number;
    channelId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'scheduledAt' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
  }) {
    const { 
      userId, 
      channelId, 
      limit = 20, 
      offset = 0, 
      sortBy = 'scheduledAt', 
      sortOrder = 'asc' 
    } = options;

    try {
      const query: Record<string, unknown> = {
        authorTgId: userId,
        status: 'scheduled'
      };

      if (channelId) {
        query.channel = new Types.ObjectId(channelId);
      }

      const sort: Record<string, 1 | -1> = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const posts = await PostModel.find(query)
        .populate('channel', 'title username chatId')
        .sort(sort)
        .skip(offset)
        .limit(limit)
        .lean();

      const total = await PostModel.countDocuments(query);

      return {
        posts,
        total,
        hasMore: total > offset + limit
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        channelId
      }, "Failed to get scheduled posts");

      return {
        posts: [],
        total: 0,
        hasMore: false
      };
    }
  }
}

// Export singleton instance
export const postScheduler = PostScheduler.getInstance();
