-- Replace search-era generic reference/search projection tables with an
-- explicit file-touch projection keyed to repo-relative file identity.

DROP TABLE IF EXISTS timeline_search_documents;
DROP TABLE IF EXISTS timeline_references;

ALTER TABLE timeline_turns
    DROP COLUMN IF EXISTS search_text;

ALTER TABLE timeline_operations
    DROP COLUMN IF EXISTS search_text;

CREATE TABLE IF NOT EXISTS timeline_file_touches (
    session_uuid UUID NOT NULL REFERENCES claude_sessions(session_uuid) ON DELETE CASCADE,
    turn_id BIGINT NOT NULL,
    touch_ord INT NOT NULL,
    operation_ord INT,
    repo_name TEXT NOT NULL,
    repo_rel_path TEXT NOT NULL,
    touch_kind TEXT NOT NULL,
    is_write BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (session_uuid, turn_id, touch_ord),
    FOREIGN KEY (session_uuid, turn_id)
        REFERENCES timeline_turns(session_uuid, turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS timeline_file_touches_session_repo_path_idx
    ON timeline_file_touches(session_uuid, repo_name, repo_rel_path);

CREATE INDEX IF NOT EXISTS timeline_file_touches_repo_path_idx
    ON timeline_file_touches(repo_name, repo_rel_path);

CREATE INDEX IF NOT EXISTS timeline_file_touches_session_turn_idx
    ON timeline_file_touches(session_uuid, turn_id, operation_ord);
