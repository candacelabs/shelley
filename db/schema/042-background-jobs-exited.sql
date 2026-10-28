-- A background job runs until its process is seen to exit. The conversation
-- list counts running jobs from here, so every change reaches it through the
-- commit hook. Notified jobs had all exited.
ALTER TABLE background_jobs ADD COLUMN exited BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE background_jobs SET exited = TRUE WHERE notified;
CREATE INDEX idx_background_jobs_running ON background_jobs(conversation_id, started_at) WHERE NOT exited;
