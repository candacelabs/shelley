-- name: GetSetting :one
SELECT value FROM settings
WHERE key = $1;

-- name: SetSetting :exec
INSERT INTO settings (key, value, updated_at)
VALUES ($1, $2, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP;

-- name: GetAllSettings :many
SELECT key, value FROM settings;

-- name: DeleteSetting :execrows
DELETE FROM settings WHERE key = $1;
