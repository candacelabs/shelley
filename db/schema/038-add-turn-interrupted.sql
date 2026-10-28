-- Persist whether an ordinary restart found a top-level conversation mid-turn.
-- Unlike agent_working, this is durable user-facing state: it remains true
-- across later restarts until the user continues the turn or starts a new one.
ALTER TABLE conversations ADD COLUMN turn_interrupted BOOLEAN NOT NULL DEFAULT FALSE;
