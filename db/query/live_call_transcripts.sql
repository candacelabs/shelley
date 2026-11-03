-- name: CreateLiveCall :one
INSERT INTO live_calls (conversation_id, call)
SELECT sqlc.arg('conversation_id'), COALESCE(MAX(call), 0) + 1
FROM live_calls WHERE conversation_id = sqlc.arg('conversation_id')
RETURNING call;

-- name: AppendLiveCallTranscript :exec
INSERT INTO live_call_transcripts (conversation_id, call, n, "user", text, start_ms, end_ms)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT DO NOTHING;

-- name: ListLiveCallTranscript :many
SELECT * FROM live_call_transcripts
WHERE conversation_id = $1 AND call = $2
ORDER BY n;
