CREATE TABLE github_user_grants (
 user_id TEXT NOT NULL, platform TEXT NOT NULL, payload TEXT NOT NULL,
 refresh_lock_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,platform)
);
