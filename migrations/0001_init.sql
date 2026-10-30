CREATE TABLE submissions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','queued','published')) DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX submissions_user ON submissions(user_id, created_at);
CREATE TABLE places (id TEXT PRIMARY KEY, payload TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE photos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE oauth_states (state TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, mobile_challenge TEXT);
CREATE TABLE mobile_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL);
