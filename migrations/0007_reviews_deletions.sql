CREATE TABLE deleted_submissions(id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE reviews(id TEXT PRIMARY KEY,place_id TEXT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),comment TEXT NOT NULL,day TEXT NOT NULL,ip_hash TEXT NOT NULL,device_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(place_id,day,ip_hash),UNIQUE(place_id,day,device_hash));
CREATE INDEX reviews_place ON reviews(place_id,created_at);
