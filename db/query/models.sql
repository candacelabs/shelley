-- name: GetModels :many
SELECT * FROM models ORDER BY created_at ASC;

-- name: GetModel :one
SELECT * FROM models WHERE model_id = $1;

-- name: CreateModel :one
INSERT INTO models (model_id, display_name, provider_type, endpoint, api_key, model_name, max_tokens, reasoning_effort, image_support, reasoning_support, reasoning_map, reasoning_replay)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: UpdateModel :one
UPDATE models
SET display_name = $1,
    provider_type = $2,
    endpoint = $3,
    api_key = $4,
    model_name = $5,
    max_tokens = $6,
    reasoning_effort = $7,
    image_support = $8,
    reasoning_support = $9,
    reasoning_map = $10,
    reasoning_replay = $11,
    updated_at = CURRENT_TIMESTAMP
WHERE model_id = $12
RETURNING *;

-- name: DeleteModel :exec
DELETE FROM models WHERE model_id = $1;
