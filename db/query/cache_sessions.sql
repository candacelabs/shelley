-- name: GetCacheSession :one
SELECT token_hash, user_id, created_at, last_seen_at
FROM cache_sessions
WHERE token_hash = $1;

-- name: UpsertCacheSession :exec
INSERT INTO cache_sessions (token_hash, user_id, created_at, last_seen_at)
VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(token_hash) DO UPDATE SET
    user_id      = excluded.user_id,
    last_seen_at = CURRENT_TIMESTAMP;

-- name: DeleteCacheSession :exec
DELETE FROM cache_sessions WHERE token_hash = $1;
