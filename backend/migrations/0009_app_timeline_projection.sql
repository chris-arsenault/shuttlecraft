-- Persist the app-shaped timeline projection so the API and search
-- surfaces read product data directly rather than rebuilding turns from
-- canonical transcript rows on every request.

ALTER TABLE tool_category_rules
    ADD COLUMN IF NOT EXISTS operation_type TEXT;

UPDATE tool_category_rules
   SET operation_type = CASE
       WHEN match_kind = 'exact' THEN pattern
       WHEN pattern = '_create' THEN 'create'
       WHEN pattern = '_update' THEN 'update'
       WHEN pattern = '_delete' THEN 'delete'
       WHEN pattern = '_add' THEN 'add'
       WHEN pattern = '_remove' THEN 'remove'
       WHEN pattern = '_reply' THEN 'reply'
       WHEN pattern = '_request' THEN 'request'
       WHEN pattern = '_resolve' THEN 'resolve'
       WHEN pattern = '_merge' THEN 'merge'
       WHEN pattern = '_label' THEN 'label'
       WHEN pattern = '_mark' THEN 'mark'
       WHEN pattern = '_convert' THEN 'convert'
       WHEN pattern = '_enable' THEN 'enable'
       WHEN pattern = '_dismiss' THEN 'dismiss'
       WHEN pattern = '_lock' THEN 'lock'
       WHEN pattern = '_unlock' THEN 'unlock'
       WHEN pattern = '_fetch' THEN 'fetch'
       WHEN pattern = '_get' THEN 'get'
       WHEN pattern = '_list' THEN 'list'
       WHEN pattern = '_search' THEN 'search'
       ELSE 'other'
   END
 WHERE operation_type IS NULL;

ALTER TABLE tool_category_rules
    ALTER COLUMN operation_type SET NOT NULL;

CREATE TABLE IF NOT EXISTS timeline_turns (
    session_uuid UUID NOT NULL REFERENCES claude_sessions(session_uuid) ON DELETE CASCADE,
    turn_id BIGINT NOT NULL,
    turn_ord INT NOT NULL,
    is_sidechain_turn BOOLEAN NOT NULL DEFAULT FALSE,
    preview TEXT NOT NULL,
    user_prompt_text TEXT,
    start_timestamp TIMESTAMPTZ NOT NULL,
    end_timestamp TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL,
    event_count INT NOT NULL,
    operation_count INT NOT NULL,
    thinking_count INT NOT NULL,
    has_errors BOOLEAN NOT NULL DEFAULT FALSE,
    markdown TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '',
    turn_json JSONB NOT NULL,
    PRIMARY KEY (session_uuid, turn_id)
);

CREATE INDEX IF NOT EXISTS timeline_turns_session_ord_idx
    ON timeline_turns(session_uuid, turn_ord ASC);

CREATE INDEX IF NOT EXISTS timeline_turns_session_sidechain_idx
    ON timeline_turns(session_uuid, is_sidechain_turn, turn_ord ASC);

CREATE TABLE IF NOT EXISTS timeline_operations (
    session_uuid UUID NOT NULL REFERENCES claude_sessions(session_uuid) ON DELETE CASCADE,
    turn_id BIGINT NOT NULL,
    operation_ord INT NOT NULL,
    pair_id TEXT NOT NULL,
    name TEXT NOT NULL,
    raw_name TEXT,
    operation_type TEXT,
    operation_category TEXT,
    input JSONB,
    result_content TEXT,
    result_is_error BOOLEAN NOT NULL DEFAULT FALSE,
    is_error BOOLEAN NOT NULL DEFAULT FALSE,
    is_pending BOOLEAN NOT NULL DEFAULT FALSE,
    search_text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (session_uuid, turn_id, operation_ord),
    FOREIGN KEY (session_uuid, turn_id)
        REFERENCES timeline_turns(session_uuid, turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS timeline_operations_session_pair_idx
    ON timeline_operations(session_uuid, pair_id);

CREATE INDEX IF NOT EXISTS timeline_operations_session_type_idx
    ON timeline_operations(session_uuid, operation_type);

CREATE INDEX IF NOT EXISTS timeline_operations_session_category_idx
    ON timeline_operations(session_uuid, operation_category);

CREATE TABLE IF NOT EXISTS timeline_references (
    session_uuid UUID NOT NULL REFERENCES claude_sessions(session_uuid) ON DELETE CASCADE,
    turn_id BIGINT NOT NULL,
    reference_ord INT NOT NULL,
    operation_ord INT,
    reference_kind TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    PRIMARY KEY (session_uuid, turn_id, reference_ord),
    FOREIGN KEY (session_uuid, turn_id)
        REFERENCES timeline_turns(session_uuid, turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS timeline_references_session_value_idx
    ON timeline_references(session_uuid, normalized_value);

CREATE TABLE IF NOT EXISTS timeline_activity_signals (
    session_uuid UUID NOT NULL REFERENCES claude_sessions(session_uuid) ON DELETE CASCADE,
    turn_id BIGINT NOT NULL,
    signal_ord INT NOT NULL,
    signal_type TEXT NOT NULL,
    signal_value TEXT,
    signal_count INT NOT NULL DEFAULT 1,
    PRIMARY KEY (session_uuid, turn_id, signal_ord),
    FOREIGN KEY (session_uuid, turn_id)
        REFERENCES timeline_turns(session_uuid, turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS timeline_activity_signals_session_type_idx
    ON timeline_activity_signals(session_uuid, signal_type, signal_value);

CREATE TABLE IF NOT EXISTS timeline_search_documents (
    session_uuid UUID NOT NULL REFERENCES claude_sessions(session_uuid) ON DELETE CASCADE,
    turn_id BIGINT NOT NULL,
    doc_ord INT NOT NULL,
    doc_kind TEXT NOT NULL,
    operation_ord INT,
    reference_ord INT,
    timestamp TIMESTAMPTZ NOT NULL,
    preview TEXT NOT NULL,
    search_text TEXT NOT NULL,
    PRIMARY KEY (session_uuid, turn_id, doc_ord),
    FOREIGN KEY (session_uuid, turn_id)
        REFERENCES timeline_turns(session_uuid, turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS timeline_search_documents_session_ts_idx
    ON timeline_search_documents(session_uuid, timestamp DESC, doc_kind);
