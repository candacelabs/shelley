CREATE TABLE model_providers (
    provider_id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    api_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    models TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);
