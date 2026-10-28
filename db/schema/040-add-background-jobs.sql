-- Bash commands moved to the background (see claudetool.BackgroundJob).
-- Jobs keep running across Shelley restarts, so their records live here:
-- on startup Shelley reports every job it has not yet notified its
-- conversation about.
CREATE TABLE background_jobs (
    job_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    tool_use_id TEXT NOT NULL,
    command TEXT NOT NULL,
    pid INTEGER NOT NULL,
    process_start_time INTEGER NOT NULL,
    log_path TEXT NOT NULL,
    exit_path TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    notified BOOLEAN NOT NULL DEFAULT FALSE
);
