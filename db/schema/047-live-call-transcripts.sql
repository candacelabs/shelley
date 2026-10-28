-- live_calls numbers a conversation's Live calls 1, 2, ... so the agent can
-- name one briefly.
CREATE TABLE live_calls (
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    call INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, call)
);

-- live_call_transcripts holds every transcript delta of a Live call as it
-- arrives, for the agent to read on demand. It is append-only and never
-- part of the model's context; delegated requests name captions by n.
CREATE TABLE live_call_transcripts (
    conversation_id TEXT NOT NULL,
    call INTEGER NOT NULL,
    n INTEGER NOT NULL,
    user BOOLEAN NOT NULL,
    text TEXT NOT NULL,
    start_ms REAL NOT NULL,
    end_ms REAL NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, call, n),
    FOREIGN KEY (conversation_id, call) REFERENCES live_calls(conversation_id, call) ON DELETE CASCADE
);
