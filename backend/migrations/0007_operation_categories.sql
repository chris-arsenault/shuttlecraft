-- Transitional copied category field on event_blocks. This was the
-- first cut at app-facing operation facets, but the durable source of
-- truth moved to the ref-data rules table added in 0008. Keeping this
-- migration lightweight means fresh databases still replay the same
-- history while older local databases can be cleaned up safely.

ALTER TABLE event_blocks
    ADD COLUMN operation_category TEXT;
