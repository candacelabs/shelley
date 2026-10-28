package db

import (
	"context"
	"encoding/json"
)

func (db *DB) SearchEnhancementModel(ctx context.Context, email string) (string, error) {
	var model string
	err := db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) error {
		return rx.QueryRow(`SELECT c.model FROM conversations c WHERE c.parent_conversation_id IS NULL AND c.model IS NOT NULL AND c.model<>'' AND coalesce(json_extract(c.conversation_options,'$.kind'),'')<>'search' AND EXISTS(SELECT 1 FROM messages m INDEXED BY idx_messages_participants WHERE m.conversation_id=c.conversation_id AND m.user_email=? AND m.user_email IS NOT NULL AND m.user_email<>'') ORDER BY c.updated_at DESC LIMIT 1`, email).Scan(&model)
	})
	return model, err
}

type SearchMessageContext struct {
	HitID, MessageID, Speaker, Text string
	Distance                        int
}

func (db *DB) SearchMessageContext(ctx context.Context, ids []string) ([]SearchMessageContext, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	var result []SearchMessageContext
	err = db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) error {
		rows, err := rx.Query(`WITH hits AS (
   SELECT message_id AS hit_id,conversation_id,sequence_id FROM messages
   WHERE message_id IN (SELECT value FROM json_each(?))
  ), nearby AS (
   SELECT h.hit_id,m.message_id,m.type,abs(m.sequence_id-h.sequence_id) AS distance,
    substr((SELECT group_concat(j.value->>'Text',char(10))
     FROM json_each(CASE WHEN json_valid(m.llm_data) THEN m.llm_data ELSE '{}' END,'$.Content') j
     WHERE j.value->>'Type'=2),1,6000) AS text
   FROM hits h CROSS JOIN messages m ON m.conversation_id=h.conversation_id
   AND m.sequence_id BETWEEN h.sequence_id-12 AND h.sequence_id+6
   WHERE m.type IN ('user','agent')
    AND (m.type='agent' OR (
     json_extract(m.user_data,'$.sender_conversation_id') IS NULL
     AND json_extract(m.user_data,'$.background_job_id') IS NULL
     AND json_extract(m.user_data,'$.mcp_server_change') IS NULL
    ))
  ) SELECT hit_id,message_id,type,distance,text FROM nearby WHERE length(trim(text))>0`, string(encoded))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SearchMessageContext
			if err := rows.Scan(&item.HitID, &item.MessageID, &item.Speaker, &item.Distance, &item.Text); err != nil {
				return err
			}
			result = append(result, item)
		}
		return rows.Err()
	})
	return result, err
}
