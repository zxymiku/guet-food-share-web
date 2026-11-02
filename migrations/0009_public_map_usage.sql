CREATE TABLE public_map_usage(bucket TEXT PRIMARY KEY,day TEXT NOT NULL,used INTEGER NOT NULL);
CREATE INDEX public_map_usage_day ON public_map_usage(day);
