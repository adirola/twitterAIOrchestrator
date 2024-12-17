export interface User {
    id: number;
    twitter_id: string;
    twitter_username: string;
    access_token: string;
    refresh_token: string | null;
    token_expires_at: Date | null;
  }
  