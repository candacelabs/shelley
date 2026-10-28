-- name: ListMCPServers :many
SELECT * FROM mcp_servers ORDER BY name;

-- name: GetMCPServer :one
SELECT * FROM mcp_servers WHERE name = ?;

-- name: CreateMCPServer :one
INSERT INTO mcp_servers (name, url, description, headers)
VALUES (?, ?, ?, ?)
ON CONFLICT (name) DO NOTHING
RETURNING *;

-- name: UpdateMCPServer :one
UPDATE mcp_servers
SET url = ?, description = ?, headers = ?, updated_at = CURRENT_TIMESTAMP
WHERE name = ?
RETURNING *;

-- name: DeleteMCPServer :execrows
DELETE FROM mcp_servers WHERE name = ?;
