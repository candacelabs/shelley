-- Streamable HTTP MCP servers. headers is a JSON object of static headers
-- sent with every request.
CREATE TABLE mcp_servers (
    name TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    headers TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- OAuth logins to MCP servers, shared by all conversations. client is the
-- registered client and its endpoints (JSON oauth2.Config); token is the
-- current oauth2.Token as JSON.
CREATE TABLE mcp_oauth (
    server_name TEXT PRIMARY KEY REFERENCES mcp_servers(name) ON DELETE CASCADE,
    client TEXT NOT NULL,
    token TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
