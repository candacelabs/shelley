-- Model providers (an endpoint and the models discovered on it). models is
-- the JSON list Shelley encodes; version guards concurrent edits.

-- name: ListModelProviders :many
SELECT provider_id, provider_type, endpoint, api_key, display_name, models, version
FROM model_providers
ORDER BY provider_id;

-- name: GetModelProvider :one
SELECT provider_id, provider_type, endpoint, api_key, display_name, models, version
FROM model_providers
WHERE provider_id = $1;

-- name: CreateModelProvider :exec
INSERT INTO model_providers (provider_id, provider_type, endpoint, api_key, display_name, models, version)
VALUES ($1, $2, $3, $4, $5, $6, 1);

-- name: UpdateModelProvider :execrows
UPDATE model_providers
SET provider_type = $2, endpoint = $3, api_key = $4, display_name = $5, models = $6, version = version + 1
WHERE provider_id = $1 AND version = sqlc.arg(expected_version);

-- name: DeleteModelProvider :execrows
DELETE FROM model_providers WHERE provider_id = $1;
