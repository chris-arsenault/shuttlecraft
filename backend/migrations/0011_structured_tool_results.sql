-- Canonical structured tool results and explicit projection fields that
-- let the timeline API read projection rows directly instead of an
-- embedded turn snapshot.

ALTER TABLE event_blocks
    ADD COLUMN IF NOT EXISTS tool_output JSONB;

ALTER TABLE timeline_turns
    ADD COLUMN IF NOT EXISTS chunks_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE timeline_operations
    ADD COLUMN IF NOT EXISTS result_payload JSONB,
    ADD COLUMN IF NOT EXISTS subagent_json JSONB;
