
import db from '../database/database';
import { PrimaryStoryboardResponse } from '../types/types';

export const addVideo = async (publicPath: string, prompt: string, data: PrimaryStoryboardResponse, name: string, userId: string) => {
    try {
        await db.result('INSERT INTO videos (public_path, prompt, data, name, created_by) VALUES ($1, $2, $3, $4, $5);', [publicPath, prompt, data, name, userId]);
    } catch (error) {
        throw new Error(`An error occurred while adding video: ${error}`);
    }
};

export const getVideosWithUpvotes = async (pageNumber: number, order?: string, userId?: string, timeframe?:  string) => {
    const timeFrameFilter = (timeframe: string) => {
        switch (timeframe) {
          case 'day':
            return "AND v.created_at >= (NOW() - INTERVAL '1 day')";
          case 'week':
            return "AND v.created_at >= (NOW() - INTERVAL '1 week')";
          case 'month':
            return "AND v.created_at >= (NOW() - INTERVAL '1 month')";
          case 'all-time':
          default:
            return '';
        }
      };
      
      const orderBy = order === 'new'
        ? 'v.created_at DESC'
        : `CASE WHEN vs.total_votes IS NULL THEN 0 ELSE vs.total_votes END DESC, v.created_at DESC`;
      
      const timeFrameCondition = timeFrameFilter(timeframe || '');
      
      const query = `
          WITH vote_summary AS (
              SELECT video_id, SUM(value) as total_votes
              FROM votes
              GROUP BY video_id
          )
          SELECT v.id, v.public_path, v.prompt, v.created_at, v.name, vs.total_votes, uv.value as user_vote
          FROM videos v
          LEFT JOIN vote_summary vs ON v.id = vs.video_id
          LEFT JOIN votes uv ON v.id = uv.video_id AND uv.user_id = $1
          WHERE 1=1 ${timeFrameCondition}
          ORDER BY ${orderBy}
          LIMIT 40 OFFSET (($2 - 1) * 40);
      `;

    try {
        return await db.any(query, [userId, pageNumber || 1]);
    } catch (error) {
        throw new Error(`An error occurred while fetching videos: ${error}`);
    }
}
