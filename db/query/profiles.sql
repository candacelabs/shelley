-- name: ListProfiles :many
SELECT * FROM profiles ORDER BY is_default DESC, name;

-- name: GetProfile :one
SELECT * FROM profiles WHERE name = $1;

-- name: GetDefaultProfile :one
SELECT * FROM profiles WHERE is_default;

-- name: CreateProfile :one
INSERT INTO profiles (name, settings)
VALUES ($1, $2)
ON CONFLICT (name) DO NOTHING
RETURNING *;

-- name: UpdateProfile :one
UPDATE profiles
SET settings = $1, user_edited = TRUE
WHERE name = $2
RETURNING *;

-- name: ClearDefaultProfile :exec
UPDATE profiles SET is_default = FALSE WHERE is_default;

-- name: SetDefaultProfile :execrows
UPDATE profiles SET is_default = TRUE WHERE name = $1;

-- name: DeleteProfile :execrows
DELETE FROM profiles WHERE name = $1 AND NOT is_default;

-- name: GetBuiltinProfile :one
SELECT * FROM builtin_profiles WHERE name = $1;

-- name: RegisterBuiltinProfile :exec
INSERT INTO builtin_profiles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;

-- name: CreateBuiltinProfile :exec
INSERT INTO profiles (name, settings, builtin, user_edited)
VALUES ($1, $2, TRUE, FALSE)
ON CONFLICT (name) DO NOTHING;

-- name: UpdateBuiltinProfile :exec
UPDATE profiles SET settings = sqlc.arg(settings)
WHERE name = sqlc.arg(name) AND builtin AND NOT user_edited AND settings != sqlc.arg(settings);

-- name: RestoreBuiltinProfile :one
UPDATE profiles SET settings = $1, user_edited = FALSE
WHERE name = $2 AND builtin
RETURNING *;
