CREATE TABLE password_login_attempts (
 bucket_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX password_login_expiry ON password_login_attempts(expires_at);
