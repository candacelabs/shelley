-- name: ListMCPServers :many
SELECT * FROM mcp_servers ORDER BY name;

-- name: GetMCPServer :one
SELECT * FROM mcp_servers WHERE name = $1;

-- name: CreateMCPServer :one
INSERT INTO mcp_servers (name, url, description, headers)
VALUES ($1, $2, $3, $4)
ON CONFLICT (name) DO NOTHING
RETURNING *;

-- name: UpdateMCPServer :one
UPDATE mcp_servers
SET url = $1, description = $2, headers = $3, updated_at = CURRENT_TIMESTAMP
WHERE name = $4
RETURNING *;

-- name: DeleteMCPServer :execrows
DELETE FROM mcp_servers WHERE name = $1;
