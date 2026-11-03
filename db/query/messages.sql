-- name: CreateMessage :one
-- created_at is normally left NULL to default to CURRENT_TIMESTAMP; see
-- db.CreateMessageParams.CreatedAt for who overrides it and why.
INSERT INTO messages (message_id, conversation_id, sequence_id, generation, type, llm_data, user_data, usage_data, display_data, excluded_from_context, llm_api_url, model_name, user_email, other_usage_data, external_message_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE(sqlc.narg('created_at'), CURRENT_TIMESTAMP))
RETURNING *;

-- name: GetNextSequenceID :one
SELECT CAST(COALESCE(MAX(sequence_id), 0) + 1 AS BIGINT)
FROM messages
WHERE conversation_id = $1;

-- name: GetMaxSequenceIDsForAllConversations :many
SELECT conversation_id, CAST(COALESCE(MAX(sequence_id), 0) AS BIGINT) AS max_sequence_id
FROM messages
GROUP BY conversation_id;

-- name: GetMessage :one
SELECT * FROM messages
WHERE message_id = $1;

-- name: ListMessages :many
SELECT * FROM messages
WHERE conversation_id = $1
ORDER BY sequence_id ASC;

-- name: ListMessagesForContext :many
SELECT m.* FROM messages m
INNER JOIN conversations c ON m.conversation_id = c.conversation_id
WHERE m.conversation_id = $1
  AND m.excluded_from_context = FALSE
  AND m.generation = c.current_generation
ORDER BY m.sequence_id ASC;

-- name: ListMessagesPaginated :many
SELECT * FROM messages
WHERE conversation_id = sqlc.arg('conversation_id')
ORDER BY sequence_id ASC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: GetGenerationAtOrBeforeSequence :one
-- Returns the generation of the last message at or before a sequence_id.
-- Used by fork to copy the generation that was active at the fork point,
-- which may be older than the conversation's current_generation.
--
-- Slug markers are excluded, matching CopyMessagesForFork. A marker is stamped
-- with whatever current_generation holds when the (racing, 15s-timeout) slug
-- goroutine lands, so a marker written after a compaction bumped the generation
-- would otherwise answer this question with the new generation and make the fork
-- copy the wrong one.
SELECT generation FROM messages
WHERE conversation_id = $1 AND sequence_id <= $2 AND type != 'slug'
ORDER BY sequence_id DESC LIMIT 1;

-- name: CopyMessagesForFork :exec
-- Copies the messages of a source conversation's given generation, up to and
-- including a cutoff sequence_id, into a destination conversation. The copies
-- are renumbered to generation 1 (the destination starts a fresh generation
-- history), get new message_ids, and preserve content, ordering, and original
-- timestamps. Used to fork a conversation.
INSERT INTO messages (message_id, conversation_id, sequence_id, generation, type, llm_data, user_data, usage_data, display_data, excluded_from_context, llm_api_url, model_name, user_email, forked_from_message_id, created_at, other_usage_data)
SELECT replace(gen_random_uuid()::text, '-', ''), sqlc.arg('dest_conversation_id'), m.sequence_id, 1, m.type, m.llm_data, m.user_data, m.usage_data, m.display_data, m.excluded_from_context, m.llm_api_url, m.model_name, m.user_email, m.message_id, m.created_at, m.other_usage_data
FROM messages m
WHERE m.conversation_id = sqlc.arg('source_conversation_id')
  AND m.sequence_id <= sqlc.arg('cutoff_sequence_id')
  AND m.generation = sqlc.arg('source_generation')
  -- Skip slug markers: a fork derives its slug from the source's synchronously,
  -- with no LLM call, so copying the marker would re-report a cost the fork
  -- never incurred. Leaving a hole in the copied sequence is fine here: this
  -- already copies a single generation while preserving source sequence_ids, so
  -- forks legitimately have gaps and clients must already tolerate them.
  AND m.type != 'slug'
ORDER BY m.sequence_id ASC;

-- name: ListMessagesByType :many
SELECT * FROM messages
WHERE conversation_id = $1 AND type = $2
ORDER BY sequence_id ASC;

-- name: GetLatestActionableMessage :one
-- The latest actionable row. Invisible slug/call-transcript bookkeeping can
-- arrive after a turn's error; it must not disable Retry/Continue affordances.
SELECT * FROM messages
WHERE conversation_id = $1 AND type NOT IN ('slug', 'livetranscript')
ORDER BY sequence_id DESC
LIMIT 1;

-- name: DeleteMessage :exec
DELETE FROM messages
WHERE message_id = $1;

-- name: DeleteConversationMessages :exec
DELETE FROM messages
WHERE conversation_id = $1;

-- name: CountMessagesInConversation :one
SELECT COUNT(*) FROM messages
WHERE conversation_id = $1;

-- name: CountMessagesByType :one
SELECT COUNT(*) FROM messages
WHERE conversation_id = $1 AND type = $2;

-- name: CountConsecutiveMessagesByType :one
-- Counts the trailing run of messages of the given type, i.e. those after the
-- last message of any OTHER type. Used to cap consecutive retry warnings.
--
-- Invisible slug/call-transcript bookkeeping doesn't break a run. Otherwise
-- an asynchronous metadata append could reset the retry-warning storm cap.
SELECT COUNT(*) FROM messages m
WHERE m.conversation_id = sqlc.arg('conversation_id')
  AND m.generation = sqlc.arg('generation')
  AND m.type = sqlc.arg('type')
  AND m.sequence_id > COALESCE(
    (SELECT MAX(prev.sequence_id) FROM messages prev
     WHERE prev.conversation_id = sqlc.arg('conversation_id')
       AND prev.generation = sqlc.arg('generation')
       AND prev.type != sqlc.arg('type')
       AND prev.type NOT IN ('slug', 'livetranscript')),
    0);

-- name: ListMessagesTail :many
-- Returns the last N messages in ascending order. If fewer than N
-- exist, returns all of them.
--
-- N counts VISIBLE messages, but invisible slug/call-transcript bookkeeping
-- inside the resulting window is still returned. Two reasons to do it this way rather than just excluding them:
-- an invisible bookkeeping row must not eat the window (?tail=1 would hand back
-- nothing displayable), yet dropping markers from the middle would punch holes
-- in the sequence space, and clients that detect lost messages by sequence
-- contiguity (see the iOS store's firstGapBoundary) would read those holes as
-- missing data and re-fetch forever.
SELECT m.* FROM messages m
WHERE m.conversation_id = sqlc.arg('conversation_id')
  AND m.sequence_id >= COALESCE((
    SELECT MIN(v.sequence_id) FROM (
      SELECT vis.sequence_id FROM messages vis
      WHERE vis.conversation_id = sqlc.arg('conversation_id')
        AND vis.type NOT IN ('slug', 'livetranscript')
      ORDER BY vis.sequence_id DESC
      LIMIT sqlc.arg('limit')::bigint
    ) v
  ), 0)
ORDER BY m.sequence_id ASC;

-- name: ListMessagesBefore :many
-- A page of rows before a sequence id, newest first.
SELECT * FROM messages
WHERE conversation_id = sqlc.arg('conversation_id') AND sequence_id < sqlc.arg('sequence_id')
ORDER BY sequence_id DESC
LIMIT sqlc.arg('limit')::bigint;

-- name: ListMessagesSince :many
-- The client cache-repair path (?last_sequence_id=N). Must NOT filter any type:
-- it is what heals a client whose view of the sequence space has a hole, so it
-- has to be able to deliver every row, markers included. Deliberately different
-- from ListMessagesTail (a display window, which counts visible rows); don't
-- "make these consistent".
SELECT * FROM messages
WHERE conversation_id = $1 AND sequence_id > $2
ORDER BY sequence_id ASC;

-- name: UpdateMessageUserData :exec
-- Mutating message rows is forbidden in production paths (messages are an
-- immutable, append-only log keyed by sequence_id and cached in the browser).
-- This UPDATE exists ONLY for the FTS-trigger test (TestMessages*), which
-- verifies the messages_fts AFTER UPDATE trigger re-indexes user_data.
UPDATE messages SET user_data = $1 WHERE message_id = $2;

-- name: ListAgentMessagesSinceLastUser :many
-- Returns the agent messages produced during the most recent user turn,
-- ordered newest-first. "Most recent user turn" = all agent messages
-- whose sequence_id is greater than the sequence_id of the most recent
-- user message (or all agent messages if there is no user message yet).
-- Used by the end-of-turn
-- notification builder to pick a useful body line.
SELECT m.message_id, m.conversation_id, m.sequence_id, m.type,
       m.llm_data, m.user_data, m.usage_data, m.created_at,
       m.display_data, m.excluded_from_context, m.generation,
       m.llm_api_url, m.model_name, m.forked_from_message_id, m.user_email,
       m.other_usage_data, m.external_message_id
FROM messages m
WHERE m.conversation_id = $1 AND m.type = 'agent'
  AND m.sequence_id > COALESCE(
    (SELECT MAX(u.sequence_id) FROM messages u
     WHERE u.conversation_id = $2 AND u.type = 'user'),
    0)
ORDER BY m.sequence_id DESC;

-- name: ListTypedUserMessages :many
-- Messages the user typed: user messages that carry neither a tool result nor
-- machine metadata, other than the stamps of a copy that a compaction carried
-- into a later generation. Originals come first, newest first, then copies: a
-- copy's original, when the conversation has it, is the message the UI shows;
-- a fork of a compacted generation has only the copies.
SELECT * FROM messages
WHERE conversation_id = $1 AND type = 'user'
  AND (user_data IS NULL OR user_data IN ('', 'null') OR (
    (user_data IS JSON) AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(messages.user_data::jsonb) u
      WHERE u.key NOT IN ('compaction_carried', 'carried_from_sequence_id', 'live_delivery_id')
    )
  ))
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(messages.llm_data::jsonb -> 'Content') WITH ORDINALITY AS c(value, key)
    WHERE (c.value ->> 'Type') = '6'
  )
ORDER BY user_data LIKE '%compaction_carried%', sequence_id DESC;

-- name: GetAgentMessageBefore :one
-- The newest agent message before sequence_id: for a tool-result message,
-- the message whose tool calls it answers.
SELECT * FROM messages
WHERE conversation_id = $1 AND type = 'agent' AND sequence_id < $2
ORDER BY sequence_id DESC
LIMIT 1;

-- name: HasExternalMessage :one
-- Whether a channel message was already recorded in the conversation.
SELECT CAST(CASE WHEN EXISTS (
  SELECT 1 FROM messages WHERE conversation_id = $1 AND external_message_id = $2
) THEN 1 ELSE 0 END AS BIGINT);

-- name: GetMaxSequenceIDForGeneration :one
SELECT COALESCE(MAX(sequence_id), 0)::bigint FROM messages
WHERE conversation_id = $1 AND generation = $2;

-- name: ListConversationParticipants :many
SELECT conversation_id, user_email::text AS user_email, COUNT(*)::bigint AS message_count
FROM messages
WHERE user_email IS NOT NULL AND user_email <> ''
  AND conversation_id = ANY(sqlc.arg(conversation_ids)::text[])
GROUP BY conversation_id, user_email
ORDER BY conversation_id, user_email;

-- name: ListSearchMessageContext :many
-- The messages around each hit (12 before, 6 after) that a person or the
-- agent wrote, with their text blocks (Content items of Type 2) joined.
WITH hits AS (
  SELECT message_id AS hit_id, conversation_id, sequence_id FROM messages
  WHERE message_id = ANY(sqlc.arg(message_ids)::text[])
), nearby AS (
  SELECT h.hit_id, m.message_id, m.type, abs(m.sequence_id - h.sequence_id)::bigint AS distance,
    substr(coalesce((
      SELECT string_agg(block->>'Text', chr(10))
      FROM jsonb_array_elements(
        CASE WHEN m.llm_data IS JSON OBJECT AND jsonb_typeof(m.llm_data::jsonb->'Content') = 'array'
             THEN m.llm_data::jsonb->'Content' ELSE '[]'::jsonb END) AS block
      WHERE block->>'Type' = '2'), ''), 1, 6000) AS text
  FROM hits h JOIN messages m ON m.conversation_id = h.conversation_id
   AND m.sequence_id BETWEEN h.sequence_id - 12 AND h.sequence_id + 6
  WHERE m.type IN ('user', 'agent')
    AND (m.type = 'agent' OR m.user_data IS NULL OR NOT (m.user_data IS JSON OBJECT) OR (
      m.user_data::jsonb->'sender_conversation_id' IS NULL
      AND m.user_data::jsonb->'background_job_id' IS NULL
      AND m.user_data::jsonb->'mcp_server_change' IS NULL))
)
SELECT hit_id::text AS hit_id, message_id, type, distance, text::text AS text FROM nearby
WHERE length(trim(text)) > 0;

-- name: ListConversationStorageSizes :many
-- Every stored row per conversation, older generations included: stored
-- size, not the active set.
SELECT COUNT(*)::bigint AS n,
       COALESCE(SUM(COALESCE(LENGTH(llm_data), 0) + COALESCE(LENGTH(user_data), 0) + COALESCE(LENGTH(display_data), 0)), 0)::bigint AS bytes
FROM messages
GROUP BY conversation_id;

-- name: CountAllMessagesByType :many
SELECT type, COUNT(*)::bigint AS count FROM messages
GROUP BY type
ORDER BY COUNT(*) DESC;
