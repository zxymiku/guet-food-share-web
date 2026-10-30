CREATE TABLE feedback (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT NOT NULL,
 request_hash TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','posted','failed')),
 issue_url TEXT, issue_number INTEGER,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX feedback_user ON feedback(user_id,created_at);
CREATE TABLE feedback_screenshots (
 feedback_id TEXT NOT NULL REFERENCES feedback(id), media_id TEXT NOT NULL REFERENCES media(id),
 access_hash TEXT NOT NULL, PRIMARY KEY(feedback_id,media_id)
);
