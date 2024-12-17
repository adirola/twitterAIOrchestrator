import { Pool } from 'pg';
import { User } from '../types';
import { TwitterApi } from 'twitter-api-v2';
import pool from '../db';

export class UserService {
  private readonly pool: Pool;
  private readonly client: TwitterApi;

  constructor() {
    this.pool = pool;
    
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
      throw new Error('Twitter credentials not configured');
    }

    this.client = new TwitterApi({
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
    });
  }

  async createOrUpdateUser(
    twitterId: string,
    username: string,
    accessToken: string,
    refreshToken: string | null = null,
    expiresIn?: number
  ): Promise<User> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    const result = await this.pool.query(
      `
      INSERT INTO users (twitter_id, twitter_username, access_token, refresh_token, token_expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (twitter_id) 
      DO UPDATE SET 
        twitter_username = $2,
        access_token = $3,
        refresh_token = $4,
        token_expires_at = $5,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [twitterId, username, accessToken, refreshToken, expiresAt]
    );

    return result.rows[0];
  }

  async getUserByTwitterId(twitterId: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE twitter_id = $1',
      [twitterId]
    );
    return result.rows[0] || null;
  }

  async refreshTokenIfNeeded(user: User): Promise<string> {
    // If there's no refresh token or expiration, just return the current access token
    if (!user.refresh_token || !user.token_expires_at) {
      return user.access_token;
    }

    // Check if token is expired
    if (new Date() >= user.token_expires_at) {
      try {
        const { accessToken, refreshToken, expiresIn } = 
          await this.client.refreshOAuth2Token(user.refresh_token);

        // Update the user with new tokens
        await this.createOrUpdateUser(
          user.twitter_id,
          user.twitter_username,
          accessToken,
          refreshToken || null,
          expiresIn
        );

        return accessToken;
      } catch (error) {
        console.error('Error refreshing token:', error);
        // If refresh fails, return current token as fallback
        return user.access_token;
      }
    }

    return user.access_token;
  }
}