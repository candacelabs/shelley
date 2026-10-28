-- name: ListProfiles :many
SELECT * FROM profiles ORDER BY is_default DESC, name;

-- name: GetProfile :one
SELECT * FROM profiles WHERE name = ?;

-- name: GetDefaultProfile :one
SELECT * FROM profiles WHERE is_default;

-- name: CreateProfile :one
INSERT INTO profiles (name, settings)
VALUES (?, ?)
ON CONFLICT (name) DO NOTHING
RETURNING *;

-- name: UpdateProfile :one
UPDATE profiles
SET settings = ?, user_edited = TRUE
WHERE name = ?
RETURNING *;

-- name: ClearDefaultProfile :exec
UPDATE profiles SET is_default = FALSE WHERE is_default;

-- name: SetDefaultProfile :execrows
UPDATE profiles SET is_default = TRUE WHERE name = ?;

-- name: DeleteProfile :execrows
DELETE FROM profiles WHERE name = ? AND NOT is_default;

-- name: GetBuiltinProfile :one
SELECT * FROM builtin_profiles WHERE name = ?;

-- name: RegisterBuiltinProfile :exec
INSERT INTO builtin_profiles (name) VALUES (?) ON CONFLICT (name) DO NOTHING;

-- name: CreateBuiltinProfile :exec
INSERT INTO profiles (name, settings, builtin, user_edited)
VALUES (?, ?, TRUE, FALSE)
ON CONFLICT (name) DO NOTHING;

-- name: UpdateBuiltinProfile :exec
UPDATE profiles SET settings = sqlc.arg(settings)
WHERE name = sqlc.arg(name) AND builtin AND NOT user_edited AND settings != sqlc.arg(settings);

-- name: RestoreBuiltinProfile :one
UPDATE profiles SET settings = ?, user_edited = FALSE
WHERE name = ? AND builtin
RETURNING *;
