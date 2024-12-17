CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    twitter_id VARCHAR(255) UNIQUE NOT NULL,
    twitter_username VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT, -- Remove NOT NULL constraint
    token_expires_at TIMESTAMP,  -- Make this optional too since it's related to refresh
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);