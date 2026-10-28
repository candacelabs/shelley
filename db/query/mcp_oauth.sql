-- name: GetMCPOAuth :one
SELECT * FROM mcp_oauth WHERE server_name = ?;

-- name: UpsertMCPOAuth :exec
INSERT INTO mcp_oauth (server_name, client, token)
VALUES (?, ?, ?)
ON CONFLICT (server_name) DO UPDATE SET
    client = excluded.client,
    token = excluded.token,
    updated_at = CURRENT_TIMESTAMP;

-- name: DeleteMCPOAuth :execrows
DELETE FROM mcp_oauth WHERE server_name = ?;
