import { PostModel, Post } from '../models/Post.js';
import type { HydratedDocument } from 'mongoose';
import { stringify } from 'csv-stringify';

export async function exportChannelPostsCSV(channelId: string): Promise<string> {
  const posts = await PostModel.find({ channel: channelId });
  return new Promise((resolve, reject) => {
  const rows = posts.map((p: HydratedDocument<Post>) => ({ id: p.id, status: p.status, views: p.viewCount, publishedAt: p.publishedAt }));
    stringify(rows, { header: true }, (err: Error | undefined | null, output: string) => {
      if (err) return reject(err);
      resolve(output);
    });
  });
}
