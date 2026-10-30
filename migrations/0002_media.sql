CREATE TABLE media (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, descriptor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX media_user ON media(user_id,created_at);
