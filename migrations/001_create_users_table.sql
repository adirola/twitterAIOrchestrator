CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    twitter_id VARCHAR(255) UNIQUE NOT NULL,
    twitter_username VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
