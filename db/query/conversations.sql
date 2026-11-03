-- name: CreateConversation :one
INSERT INTO conversations (conversation_id, slug, user_initiated, cwd, model, conversation_options)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateDraftConversation :one
-- Creates a conversation in draft state with the given initial draft text.
-- Drafts have no messages; the chat handler clears is_draft / draft when
-- the user sends their first message via PromoteDraftConversation.
INSERT INTO conversations (conversation_id, slug, user_initiated, cwd, model, conversation_options, is_draft, draft)
VALUES ($1, $2, TRUE, $3, $4, $5, TRUE, $6)
RETURNING *;

-- name: UpdateConversationDraft :one
-- Partially updates a draft conversation: any NULL argument keeps the
-- current value (text, model, and cwd each update independently), and
-- updated_at bumps so the conversation list reorders. The is_draft guard
-- makes this atomic: a draft promoted concurrently yields no rows
-- (ErrConversationNotDraft) rather than mutating an active conversation,
-- whose cwd is immutable and whose model only changes through the /model
-- loop switch.
UPDATE conversations
SET draft = COALESCE(sqlc.narg('draft'), draft),
    model = COALESCE(sqlc.narg('model'), model),
    cwd = COALESCE(sqlc.narg('cwd'), cwd),
    updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = sqlc.arg('conversation_id') AND is_draft = TRUE
RETURNING *;

-- name: PromoteDraftConversation :one
-- Clears the draft state when the user sends the first message.
UPDATE conversations
SET is_draft = FALSE, draft = '', updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $1 AND is_draft = TRUE
RETURNING *;

-- name: GetConversation :one
SELECT * FROM conversations
WHERE conversation_id = $1;

-- name: GetConversationBySlug :one
SELECT * FROM conversations
WHERE slug = $1;

-- name: ListConversations :many
SELECT sqlc.embed(c),
  -- preview_packed: locate the newest agent message that actually contains a
  -- text block (the EXISTS short-circuits on the first one), then pull that
  -- block. The outer ORDER BY rides idx_messages_conv_type_seq, so we stop at
  -- the first qualifying message instead of expanding and globally sorting
  -- every agent message's content blocks. The first 20 bytes are the fixed
  -- RFC3339 timestamp (strftime '%Y-%m-%dT%H:%M:%SZ'); the rest is the preview
  -- text capped to 300 chars so we don't haul multi-KB replies across the
  -- driver + JSON + gzip for a one-line UI field. db.splitPreviewPacked splits
  -- it back apart.
  CAST(COALESCE((
    SELECT to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || substr((
             SELECT je.value ->> 'Text'
               FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
              WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> ''
              ORDER BY je.key DESC LIMIT 1), 1, 300)
      FROM messages m
     WHERE m.conversation_id = c.conversation_id AND m.type = 'agent'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
                   WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> '')
     ORDER BY m.sequence_id DESC LIMIT 1), '') AS TEXT) AS preview_packed,
  CAST(COALESCE((
    SELECT MAX(m.sequence_id) FROM messages m
     WHERE m.conversation_id = c.conversation_id), 0) AS BIGINT) AS max_sequence_id,
  -- participants_json: the distinct exe.dev accounts that authored messages in
  -- this conversation (messages.user_email, stamped from the X-ExeDev-Email
  -- header), as a JSON array. The order is SQLite's business, so
  -- db.decodeParticipants sorts it: the conversation-list patch stream hashes
  -- the marshalled list, and an unstable order would emit spurious diffs.
  -- Rides idx_messages_participants (a partial covering index over authored
  -- messages), so this costs one index seek per listed conversation.
  CAST(COALESCE((
    SELECT json_agg(json_build_object(
             'email', participant.user_email,
             'message_count', participant.message_count))
      FROM (
        SELECT m.user_email, COUNT(*) AS message_count
          FROM messages m
         WHERE m.conversation_id = c.conversation_id
           AND m.user_email IS NOT NULL AND m.user_email <> ''
         GROUP BY m.user_email
      ) participant), '[]') AS TEXT) AS participants_json,
  -- Subagents ride idx_conversations_parent_id; running jobs ride
  -- idx_background_jobs_running.
  CAST((SELECT COUNT(*) FROM conversations sub
         WHERE sub.parent_conversation_id = c.conversation_id) AS BIGINT) AS subagent_count,
  CAST((SELECT COUNT(*) FROM background_jobs bj
         WHERE bj.conversation_id = c.conversation_id AND NOT bj.exited) AS BIGINT) AS running_background_jobs
FROM conversations c
WHERE c.archived = FALSE AND c.parent_conversation_id IS NULL
ORDER BY c.updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: ListAllConversations :many
-- Like ListConversations but includes subagents. Used by the conversation
-- list patch stream so the UI can render subagents inline and pick up their
-- working state from diffs alone.
SELECT sqlc.embed(c),
  -- preview_packed: locate the newest agent message that actually contains a
  -- text block (the EXISTS short-circuits on the first one), then pull that
  -- block. The outer ORDER BY rides idx_messages_conv_type_seq, so we stop at
  -- the first qualifying message instead of expanding and globally sorting
  -- every agent message's content blocks. The first 20 bytes are the fixed
  -- RFC3339 timestamp (strftime '%Y-%m-%dT%H:%M:%SZ'); the rest is the preview
  -- text capped to 300 chars so we don't haul multi-KB replies across the
  -- driver + JSON + gzip for a one-line UI field. db.splitPreviewPacked splits
  -- it back apart.
  CAST(COALESCE((
    SELECT to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || substr((
             SELECT je.value ->> 'Text'
               FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
              WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> ''
              ORDER BY je.key DESC LIMIT 1), 1, 300)
      FROM messages m
     WHERE m.conversation_id = c.conversation_id AND m.type = 'agent'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
                   WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> '')
     ORDER BY m.sequence_id DESC LIMIT 1), '') AS TEXT) AS preview_packed,
  CAST(COALESCE((
    SELECT MAX(m.sequence_id) FROM messages m
     WHERE m.conversation_id = c.conversation_id), 0) AS BIGINT) AS max_sequence_id,
  -- See participants_json note on ListConversations.
  CAST(COALESCE((
    SELECT json_agg(json_build_object(
             'email', participant.user_email,
             'message_count', participant.message_count))
      FROM (
        SELECT m.user_email, COUNT(*) AS message_count
          FROM messages m
         WHERE m.conversation_id = c.conversation_id
           AND m.user_email IS NOT NULL AND m.user_email <> ''
         GROUP BY m.user_email
      ) participant), '[]') AS TEXT) AS participants_json,
  -- Subagents ride idx_conversations_parent_id; running jobs ride
  -- idx_background_jobs_running.
  CAST((SELECT COUNT(*) FROM conversations sub
         WHERE sub.parent_conversation_id = c.conversation_id) AS BIGINT) AS subagent_count,
  CAST((SELECT COUNT(*) FROM background_jobs bj
         WHERE bj.conversation_id = c.conversation_id AND NOT bj.exited) AS BIGINT) AS running_background_jobs
FROM conversations c
WHERE c.archived = FALSE
ORDER BY c.updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: ListArchivedConversations :many
SELECT * FROM conversations
WHERE archived = TRUE
ORDER BY updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: SearchConversations :many
SELECT sqlc.embed(c),
  -- preview_packed: locate the newest agent message that actually contains a
  -- text block (the EXISTS short-circuits on the first one), then pull that
  -- block. The outer ORDER BY rides idx_messages_conv_type_seq, so we stop at
  -- the first qualifying message instead of expanding and globally sorting
  -- every agent message's content blocks. The first 20 bytes are the fixed
  -- RFC3339 timestamp (strftime '%Y-%m-%dT%H:%M:%SZ'); the rest is the preview
  -- text capped to 300 chars so we don't haul multi-KB replies across the
  -- driver + JSON + gzip for a one-line UI field. db.splitPreviewPacked splits
  -- it back apart.
  CAST(COALESCE((
    SELECT to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || substr((
             SELECT je.value ->> 'Text'
               FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
              WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> ''
              ORDER BY je.key DESC LIMIT 1), 1, 300)
      FROM messages m
     WHERE m.conversation_id = c.conversation_id AND m.type = 'agent'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
                   WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> '')
     ORDER BY m.sequence_id DESC LIMIT 1), '') AS TEXT) AS preview_packed,
  CAST(COALESCE((
    SELECT MAX(m.sequence_id) FROM messages m
     WHERE m.conversation_id = c.conversation_id), 0) AS BIGINT) AS max_sequence_id,
  -- See participants_json note on ListConversations.
  CAST(COALESCE((
    SELECT json_agg(json_build_object(
             'email', participant.user_email,
             'message_count', participant.message_count))
      FROM (
        SELECT m.user_email, COUNT(*) AS message_count
          FROM messages m
         WHERE m.conversation_id = c.conversation_id
           AND m.user_email IS NOT NULL AND m.user_email <> ''
         GROUP BY m.user_email
      ) participant), '[]') AS TEXT) AS participants_json,
  -- Subagents ride idx_conversations_parent_id; running jobs ride
  -- idx_background_jobs_running.
  CAST((SELECT COUNT(*) FROM conversations sub
         WHERE sub.parent_conversation_id = c.conversation_id) AS BIGINT) AS subagent_count,
  CAST((SELECT COUNT(*) FROM background_jobs bj
         WHERE bj.conversation_id = c.conversation_id AND NOT bj.exited) AS BIGINT) AS running_background_jobs
FROM conversations c
WHERE c.slug LIKE '%' || sqlc.arg('column_1') || '%' AND c.archived = FALSE AND c.parent_conversation_id IS NULL
ORDER BY c.updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: SearchConversationsWithMessages :many
-- Search conversations by slug OR message content (user messages and agent responses, not system prompts)
-- Includes both top-level conversations and subagent conversations
SELECT DISTINCT sqlc.embed(c),
  CAST(CASE WHEN c.slug LIKE '%' || sqlc.arg('query') || '%' THEN 0 ELSE 1 END AS BIGINT) AS slug_rank,
  -- See preview_packed note on ListConversations. Inner messages alias is
  -- pm here to avoid colliding with the outer LEFT JOIN messages m.
  CAST(COALESCE((
    SELECT to_char(pm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || substr((
             SELECT je.value ->> 'Text'
               FROM jsonb_array_elements(pm.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
              WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> ''
              ORDER BY je.key DESC LIMIT 1), 1, 300)
      FROM messages pm
     WHERE pm.conversation_id = c.conversation_id AND pm.type = 'agent'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(pm.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
                   WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> '')
     ORDER BY pm.sequence_id DESC LIMIT 1), '') AS TEXT) AS preview_packed,
  CAST(COALESCE((
    SELECT MAX(pm.sequence_id) FROM messages pm
     WHERE pm.conversation_id = c.conversation_id), 0) AS BIGINT) AS max_sequence_id,
  -- See participants_json note on ListConversations.
  CAST(COALESCE((
    SELECT json_agg(json_build_object(
             'email', participant.user_email,
             'message_count', participant.message_count))
      FROM (
        SELECT pm.user_email, COUNT(*) AS message_count
          FROM messages pm
         WHERE pm.conversation_id = c.conversation_id
           AND pm.user_email IS NOT NULL AND pm.user_email <> ''
         GROUP BY pm.user_email
      ) participant), '[]') AS TEXT) AS participants_json,
  -- Subagents ride idx_conversations_parent_id; running jobs ride
  -- idx_background_jobs_running.
  CAST((SELECT COUNT(*) FROM conversations sub
         WHERE sub.parent_conversation_id = c.conversation_id) AS BIGINT) AS subagent_count,
  CAST((SELECT COUNT(*) FROM background_jobs bj
         WHERE bj.conversation_id = c.conversation_id AND NOT bj.exited) AS BIGINT) AS running_background_jobs
FROM conversations c
LEFT JOIN messages m ON c.conversation_id = m.conversation_id AND m.type IN ('user', 'agent')
WHERE c.archived = FALSE
  AND (
    c.slug LIKE '%' || sqlc.arg('query') || '%'
    OR (m.user_data::jsonb ->> 'text') LIKE '%' || sqlc.arg('query') || '%'
    OR m.llm_data LIKE '%' || sqlc.arg('query') || '%'
  )
ORDER BY slug_rank, c.updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: SearchConversationsFTSList :many
-- Top-level conversations matching either a slug substring or an FTS5 MATCH
-- against messages_fts, with slug matches first. The caller builds
-- both the LIKE pattern (with %, _, \ pre-escaped) and the MATCH
-- expression from user input.
WITH fts_hits AS (
  SELECT m.conversation_id
  FROM messages_fts
  JOIN messages m ON m.message_id = messages_fts.message_id
  JOIN conversations eligible ON eligible.conversation_id = m.conversation_id
  WHERE messages_fts.document @@ websearch_to_tsquery('english', sqlc.narg('fts_match')::text)
    AND eligible.parent_conversation_id IS NULL
    AND eligible.archived = sqlc.arg('archived')
    AND (eligible.conversation_options::jsonb ->> 'kind') IS DISTINCT FROM 'search'
  GROUP BY m.conversation_id
  ORDER BY max(eligible.updated_at) DESC
  LIMIT sqlc.arg('limit')::bigint + sqlc.arg('offset')::bigint
)
SELECT sqlc.embed(c),
  CAST(CASE WHEN c.slug LIKE sqlc.narg('slug_like')::text ESCAPE '\' THEN 0 ELSE 1 END AS BIGINT) AS slug_rank,
  -- preview_packed: locate the newest agent message that actually contains a
  -- text block (the EXISTS short-circuits on the first one), then pull that
  -- block. The outer ORDER BY rides idx_messages_conv_type_seq, so we stop at
  -- the first qualifying message instead of expanding and globally sorting
  -- every agent message's content blocks. The first 20 bytes are the fixed
  -- RFC3339 timestamp (strftime '%Y-%m-%dT%H:%M:%SZ'); the rest is the preview
  -- text capped to 300 chars so we don't haul multi-KB replies across the
  -- driver + JSON + gzip for a one-line UI field. db.splitPreviewPacked splits
  -- it back apart.
  CAST(COALESCE((
    SELECT to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || substr((
             SELECT je.value ->> 'Text'
               FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
              WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> ''
              ORDER BY je.key DESC LIMIT 1), 1, 300)
      FROM messages m
     WHERE m.conversation_id = c.conversation_id AND m.type = 'agent'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.llm_data::jsonb -> 'Content') WITH ORDINALITY AS je(value, key)
                   WHERE (je.value ->> 'Type') = '2' AND je.value ->> 'Text' <> '')
     ORDER BY m.sequence_id DESC LIMIT 1), '') AS TEXT) AS preview_packed,
  CAST(COALESCE((
    SELECT MAX(m.sequence_id) FROM messages m
     WHERE m.conversation_id = c.conversation_id), 0) AS BIGINT) AS max_sequence_id,
  -- See participants_json note on ListConversations.
  CAST(COALESCE((
    SELECT json_agg(json_build_object(
             'email', participant.user_email,
             'message_count', participant.message_count))
      FROM (
        SELECT m.user_email, COUNT(*) AS message_count
          FROM messages m
         WHERE m.conversation_id = c.conversation_id
           AND m.user_email IS NOT NULL AND m.user_email <> ''
         GROUP BY m.user_email
      ) participant), '[]') AS TEXT) AS participants_json,
  -- Subagents ride idx_conversations_parent_id; running jobs ride
  -- idx_background_jobs_running.
  CAST((SELECT COUNT(*) FROM conversations sub
         WHERE sub.parent_conversation_id = c.conversation_id) AS BIGINT) AS subagent_count,
  CAST((SELECT COUNT(*) FROM background_jobs bj
         WHERE bj.conversation_id = c.conversation_id AND NOT bj.exited) AS BIGINT) AS running_background_jobs
FROM conversations c
WHERE c.parent_conversation_id IS NULL
  AND c.archived = sqlc.arg('archived')
  AND (c.conversation_options::jsonb ->> 'kind') IS DISTINCT FROM 'search'
  AND (
    c.slug LIKE sqlc.narg('slug_like')::text ESCAPE '\'
    OR c.conversation_id IN (SELECT conversation_id FROM fts_hits)
  )
ORDER BY slug_rank, c.archived ASC, c.updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: SearchArchivedConversations :many
SELECT * FROM conversations
WHERE slug LIKE '%' || sqlc.arg('column_1') || '%' AND archived = TRUE
ORDER BY updated_at DESC
LIMIT sqlc.arg('limit')::bigint OFFSET sqlc.arg('offset')::bigint;

-- name: UpdateConversationSlug :one
UPDATE conversations
SET slug = $1, updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $2
RETURNING *;

-- name: UpdateConversationTimestamp :exec
UPDATE conversations
SET updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $1;

-- name: IncrementConversationGeneration :one
UPDATE conversations
SET current_generation = current_generation + 1,
    turn_interrupted = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $1
RETURNING *;

-- name: SetConversationGeneration :one
-- Used to roll back a failed compaction: the generation counter is bumped
-- before summarization runs, so on failure we restore the previous value to
-- keep the old (intact) generation active.
UPDATE conversations
SET current_generation = sqlc.arg('current_generation'),
    turn_interrupted = sqlc.arg('turn_interrupted'),
    updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = sqlc.arg('conversation_id')
RETURNING *;

-- name: DeleteConversation :exec
DELETE FROM conversations
WHERE conversation_id = $1;

-- name: CountConversations :one
SELECT COUNT(*) FROM conversations WHERE archived = FALSE AND parent_conversation_id IS NULL;

-- name: ArchiveConversation :one
UPDATE conversations
SET archived = TRUE
WHERE conversation_id = $1
RETURNING *;

-- name: UnarchiveConversation :one
UPDATE conversations
SET archived = FALSE
WHERE conversation_id = $1
RETURNING *;

-- name: UpdateConversationCwd :one
UPDATE conversations
SET cwd = $1, updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $2
RETURNING *;


-- name: CreateSubagentConversation :one
INSERT INTO conversations (conversation_id, slug, user_initiated, cwd, parent_conversation_id)
VALUES ($1, $2, FALSE, $3, $4)
RETURNING *;

-- name: GetSubagents :many
SELECT * FROM conversations
WHERE parent_conversation_id = $1
ORDER BY created_at ASC;

-- name: GetSubagentUsage :many
-- Per-call LLM usage across all descendant conversations (subagents,
-- recursively). Powers the "plus $X for subagents" line in the token-cost
-- graph; the parent's own usage is not included. Returned one row per call
-- (not aggregated) so handleSubagentUsage can price each call by the
-- context-size tier its prompt lands in before summing.
WITH RECURSIVE descendants(conversation_id) AS (
  SELECT p.conversation_id FROM conversations p WHERE p.parent_conversation_id = $1
  UNION ALL
  SELECT c.conversation_id FROM conversations c
  JOIN descendants d ON c.parent_conversation_id = d.conversation_id
)
SELECT
  m.model_name,
  m.llm_api_url,
  CAST(COALESCE(m.usage_data ->> 'input_tokens', 0) AS BIGINT) AS input_tokens,
  CAST(COALESCE(m.usage_data ->> 'cache_creation_input_tokens', 0) AS BIGINT) AS cache_creation_input_tokens,
  CAST(COALESCE(m.usage_data ->> 'cache_read_input_tokens', 0) AS BIGINT) AS cache_read_input_tokens,
  CAST(COALESCE(m.usage_data ->> 'output_tokens', 0) AS BIGINT) AS output_tokens,
  CAST(COALESCE(m.usage_data ->> 'cost_usd', 0) AS DOUBLE PRECISION) AS cost_usd
-- CROSS JOIN keeps the small descendants set outermost. A regular JOIN lets
-- SQLite start from every agent message, which makes this query scan the full
-- messages table even when the conversation has no subagents.
FROM descendants d
CROSS JOIN messages m
WHERE m.conversation_id = d.conversation_id
  AND m.type = 'agent' AND m.usage_data IS NOT NULL
  -- Synthetic end-of-turn markers have usage_data but no tokens or cost.
  AND (m.usage_data ->> 'input_tokens' > 0
    OR m.usage_data ->> 'cache_creation_input_tokens' > 0
    OR m.usage_data ->> 'cache_read_input_tokens' > 0
    OR m.usage_data ->> 'output_tokens' > 0
    OR m.usage_data ->> 'cost_usd' > 0);

-- name: GetSubagentOtherUsage :many
-- Per-entry indirect LLM usage (messages.other_usage_data entries) across all
-- descendant conversations (subagents, recursively). Folded into
-- handleSubagentUsage's totals alongside GetSubagentUsage; the parent's own
-- indirect usage rides on its own messages instead. Returned one row per
-- entry (not aggregated) so each can be priced by its context-size tier.
WITH RECURSIVE descendants(conversation_id) AS (
  SELECT p.conversation_id FROM conversations p WHERE p.parent_conversation_id = $1
  UNION ALL
  SELECT c.conversation_id FROM conversations c
  JOIN descendants d ON c.parent_conversation_id = d.conversation_id
)
SELECT
  CAST(COALESCE(je.value ->> 'model', '') AS TEXT) AS model_name,
  CAST(COALESCE(je.value ->> 'url', '') AS TEXT) AS llm_api_url,
  CAST(COALESCE(je.value ->> 'input_tokens', 0) AS BIGINT) AS input_tokens,
  CAST(COALESCE(je.value ->> 'cache_creation_input_tokens', 0) AS BIGINT) AS cache_creation_input_tokens,
  CAST(COALESCE(je.value ->> 'cache_read_input_tokens', 0) AS BIGINT) AS cache_read_input_tokens,
  CAST(COALESCE(je.value ->> 'output_tokens', 0) AS BIGINT) AS output_tokens,
  CAST(COALESCE(je.value ->> 'cost_usd', 0) AS DOUBLE PRECISION) AS cost_usd
-- Keep descendants outermost here too, before expanding each matching
-- message's JSON. See GetSubagentUsage above.
FROM descendants d
CROSS JOIN messages m
CROSS JOIN jsonb_each(m.other_usage_data::jsonb) je
WHERE m.conversation_id = d.conversation_id
  AND m.other_usage_data IS NOT NULL;

-- name: GetConversationBySlugAndParent :one
SELECT * FROM conversations
WHERE slug = $1 AND parent_conversation_id = $2;

-- name: UpdateConversationModel :exec
UPDATE conversations
SET model = $1
WHERE conversation_id = $2 AND model IS NULL;

-- name: ForceUpdateConversationModel :exec
UPDATE conversations
SET model = $1, updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $2;

-- name: GetConversationOptions :one
SELECT conversation_options FROM conversations
WHERE conversation_id = $1;

-- name: UpdateConversationOptions :exec
UPDATE conversations
SET conversation_options = $1
WHERE conversation_id = $2;

-- name: GetConversationQueuedMessages :one
SELECT queued_messages FROM conversations
WHERE conversation_id = $1;

-- name: UpdateConversationQueuedMessages :exec
-- Replaces the queued-messages JSON array and bumps updated_at so the
-- conversation re-sorts and a list-patch diff is emitted for the change.
UPDATE conversations
SET queued_messages = $1, updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $2;

-- name: UpdateConversationParent :one
UPDATE conversations
SET parent_conversation_id = $1, updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = $2
RETURNING *;

-- name: SetConversationAgentWorking :exec
-- Sets the agent_working flag. Starting any turn also resolves a prior
-- interruption: the user either clicked Continue or deliberately sent new
-- input instead. Deliberately does NOT bump updated_at; runtime state changes
-- must not reorder the conversation list.
UPDATE conversations
SET agent_working = sqlc.arg('agent_working'),
    turn_interrupted = CASE
      WHEN sqlc.arg('agent_working') THEN FALSE
      ELSE turn_interrupted
    END
WHERE conversation_id = sqlc.arg('conversation_id');

-- name: SetConversationTurnInterrupted :exec
-- Records durable user-facing restart state without adding transcript rows or
-- reordering the conversation list.
UPDATE conversations
SET turn_interrupted = sqlc.arg('turn_interrupted')
WHERE conversation_id = sqlc.arg('conversation_id');

-- name: ClaimInterruptedTurn :execrows
-- Atomically moves a manually resumed conversation from interrupted+idle to
-- working. The guard makes duplicate clicks and cross-request races harmless.
UPDATE conversations
SET turn_interrupted = FALSE,
    agent_working = TRUE
WHERE conversation_id = sqlc.arg('conversation_id')
  AND turn_interrupted = TRUE
  AND agent_working = FALSE
  AND parent_conversation_id IS NULL;

-- name: ClaimUpgradeInterruptedTurn :execrows
-- Atomically validates the durable turn version captured before listeners
-- opened and marks that exact stale turn claimed. The marker is hidden while
-- agent_working is true, survives another crash as a manual interruption, and
-- prevents duplicate resume workers. New user work changes the message version.
UPDATE conversations
SET turn_interrupted = TRUE
WHERE conversations.conversation_id = sqlc.arg('conversation_id')
  AND conversations.agent_working = TRUE
  AND conversations.turn_interrupted = FALSE
  AND conversations.current_generation = sqlc.arg('current_generation')
  AND (SELECT COALESCE(MAX(sequence_id), 0)
       FROM messages
       WHERE messages.conversation_id = conversations.conversation_id
         AND messages.type = 'user') = sqlc.arg('max_user_sequence_id');

-- name: FinishUpgradeInterruptedTurn :execrows
-- Clears the hidden claim immediately before the automatic retry. Failures
-- after this point restore the visible manual interruption state.
UPDATE conversations
SET turn_interrupted = FALSE
WHERE conversation_id = sqlc.arg('conversation_id')
  AND agent_working = TRUE
  AND turn_interrupted = TRUE;

-- name: MarkUpgradeResumeInterrupted :execrows
-- Converts a failed automatic resume into the ordinary manual-recovery state,
-- but only while the startup token still names the same durable turn.
-- Subagents have no manual resume; they just become idle.
UPDATE conversations
SET agent_working = FALSE,
    turn_interrupted = conversations.parent_conversation_id IS NULL
WHERE conversations.conversation_id = sqlc.arg('conversation_id')
  AND conversations.agent_working = TRUE
  AND conversations.current_generation = sqlc.arg('current_generation')
  AND (SELECT COALESCE(MAX(sequence_id), 0)
       FROM messages
       WHERE messages.conversation_id = conversations.conversation_id
         AND messages.type = 'user') = sqlc.arg('max_user_sequence_id');

-- name: ResetAllAgentWorking :exec
-- Called on server startup to clear any stale TRUE values left over from a
-- previous process that exited mid-turn. Does not bump updated_at.
UPDATE conversations
SET agent_working = FALSE
WHERE agent_working = TRUE;

-- name: ListAgentWorkingConversationIDs :many
-- Conversations left with agent_working = TRUE by the previous process. Used
-- on the resume-after-upgrade path (see DB.ConsumeResumeAfterUpgrade) to find
-- the turns that were interrupted by the upgrade restart.
SELECT conversation_id FROM conversations
WHERE agent_working = TRUE
ORDER BY updated_at DESC;

-- name: SearchConversationsFTSSnippets :many
-- Best-ranked snippet per conversation for the given conversation IDs: the
-- message whose text ranks highest for the query, its matched fragment marked
-- by mark_start and mark_end.
WITH ranked AS (
  SELECT m.conversation_id, m.message_id,
         row_number() OVER (
           PARTITION BY m.conversation_id
           ORDER BY ts_rank(hits.document, websearch_to_tsquery('english', sqlc.narg('fts_match')::text)) DESC
         ) AS rank_in_conversation
  FROM messages m
  JOIN messages_fts hits ON hits.message_id = m.message_id
  WHERE hits.document @@ websearch_to_tsquery('english', sqlc.narg('fts_match')::text)
    AND m.conversation_id = ANY(sqlc.arg(conv_ids)::text[])
)
SELECT ranked.conversation_id, ranked.message_id,
       ts_headline('english', messages_fts.text, websearch_to_tsquery('english', sqlc.narg('fts_match')::text),
         'StartSel=' || sqlc.arg(mark_start)::text || ', StopSel=' || sqlc.arg(mark_end)::text ||
         ', MaxWords=16, MinWords=4, FragmentDelimiter=...')::text AS snippet
FROM messages_fts
JOIN ranked ON ranked.message_id = messages_fts.message_id
WHERE ranked.rank_in_conversation = 1;

-- name: UpdateConversationTags :one
-- Tagging is a metadata-only edit; deliberately does not bump updated_at
-- so retagging old conversations doesn't reorder the list.
UPDATE conversations
SET tags = $1
WHERE conversation_id = $2
RETURNING *;

-- name: ListConversationsWithQueuedTranscriptions :many
-- Every conversation (archived or not) whose durable queue holds a
-- transcription item. Used once at startup to recover detached workers.
SELECT * FROM conversations
WHERE queued_messages LIKE '%"kind":"transcription"%'
ORDER BY created_at ASC;

-- name: ListCommitTourWorkers :many
-- Specialized child conversations durably tracking requested commit tours.
SELECT * FROM conversations
WHERE parent_conversation_id IS NOT NULL
  AND user_initiated = FALSE
  AND conversation_options LIKE '%"kind":"commit-tour"%'
ORDER BY created_at ASC, conversation_id ASC;

-- name: CreateChannelConversation :one
INSERT INTO conversations (conversation_id, user_initiated, model, conversation_options, external_conversation_id, external_endpoint)
VALUES ($1, TRUE, $2, $3, $4, $5)
RETURNING *;

-- name: GetConversationByExternalID :one
SELECT * FROM conversations WHERE external_conversation_id = $1;

-- name: ListChannelConversationsWithQueuedMessages :many
-- Conversations bound to an external chat with queued messages. Used once
-- at startup to drain them.
SELECT * FROM conversations
WHERE external_conversation_id IS NOT NULL AND queued_messages != '[]'
ORDER BY created_at ASC;

-- name: GetSearchEnhancementModel :one
-- The model of the newest top-level, non-search conversation this person
-- wrote in.
SELECT c.model::text AS model FROM conversations c
WHERE c.parent_conversation_id IS NULL AND c.model IS NOT NULL AND c.model <> ''
  AND coalesce(c.conversation_options::jsonb->>'kind', '') <> 'search'
  AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.conversation_id
              AND m.user_email = sqlc.arg(email)::text AND m.user_email <> '')
ORDER BY c.updated_at DESC
LIMIT 1;

-- name: CountConversationsByGeneration :many
SELECT c.current_generation, COUNT(*)::bigint AS count FROM conversations c
WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.conversation_id)
GROUP BY c.current_generation
ORDER BY c.current_generation;
