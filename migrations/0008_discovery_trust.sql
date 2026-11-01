ALTER TABLE reviews ADD COLUMN user_id TEXT;
ALTER TABLE reviews ADD COLUMN removed_at TEXT;
CREATE UNIQUE INDEX reviews_user_day ON reviews(place_id,day,user_id);
CREATE INDEX reviews_chronology ON reviews(place_id,removed_at,created_at DESC,id DESC);
CREATE TABLE hidden_places(place_id TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE reports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,target_type TEXT NOT NULL CHECK(target_type IN ('place','review')),target_id TEXT NOT NULL,reason TEXT NOT NULL,detail TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,target_type,target_id,day));
CREATE INDEX reports_queue ON reports(status,created_at DESC);
CREATE TABLE moderation_events(id TEXT PRIMARY KEY,report_id TEXT NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
