-- Conversations take their profile's edits until they edit their own
-- settings. Those from before can't tell, so they keep their settings.
UPDATE conversations
SET conversation_options = json_set(conversation_options, '$.settings_edited', json('true'))
WHERE json_extract(conversation_options, '$.profile') IS NOT NULL;
