-- Conversations bound to an external chat (a channel), such as the exe.dev
-- messages integration's iMessage/RCS/SMS chat. Each external chat maps to
-- one conversation: external_conversation_id is the channel's chat id, and
-- external_endpoint is the base URL Shelley sends that chat's replies to.
ALTER TABLE conversations ADD COLUMN external_conversation_id TEXT;
ALTER TABLE conversations ADD COLUMN external_endpoint TEXT;
CREATE UNIQUE INDEX idx_conversations_external_conversation_id
    ON conversations(external_conversation_id) WHERE external_conversation_id IS NOT NULL;

-- The channel's id for a user message that arrived from an external chat.
ALTER TABLE messages ADD COLUMN external_message_id TEXT;
CREATE INDEX idx_messages_external_message_id
    ON messages(conversation_id, external_message_id) WHERE external_message_id IS NOT NULL;
