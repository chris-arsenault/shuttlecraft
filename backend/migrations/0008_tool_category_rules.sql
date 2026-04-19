-- App-facing operation categories are ref data, not transcript data.
-- We project them at read time from canonical tool names so changing a
-- rule updates historical rows without rewriting event_blocks.

CREATE TABLE IF NOT EXISTS tool_category_rules (
    id BIGSERIAL PRIMARY KEY,
    match_kind TEXT NOT NULL CHECK (match_kind IN ('exact', 'prefix')),
    pattern TEXT NOT NULL,
    operation_category TEXT NOT NULL CHECK (
        operation_category IN (
            'create_content',
            'inspect',
            'utility',
            'research',
            'delegate',
            'workflow',
            'other'
        )
    ),
    precedence INT NOT NULL,
    UNIQUE (match_kind, pattern)
);

INSERT INTO tool_category_rules (match_kind, pattern, operation_category, precedence)
VALUES
    ('exact', 'write', 'create_content', 10),
    ('exact', 'edit', 'create_content', 10),
    ('exact', 'multi_edit', 'create_content', 10),
    ('exact', 'apply_patch', 'create_content', 10),
    ('exact', 'read', 'inspect', 10),
    ('exact', 'grep', 'inspect', 10),
    ('exact', 'glob', 'inspect', 10),
    ('exact', 'open', 'inspect', 10),
    ('exact', 'click', 'inspect', 10),
    ('exact', 'find', 'inspect', 10),
    ('exact', 'screenshot', 'inspect', 10),
    ('exact', 'view_image', 'inspect', 10),
    ('exact', 'list_mcp_resources', 'inspect', 10),
    ('exact', 'list_mcp_resource_templates', 'inspect', 10),
    ('exact', 'read_mcp_resource', 'inspect', 10),
    ('exact', 'bash', 'utility', 10),
    ('exact', 'exec_command', 'utility', 10),
    ('exact', 'write_stdin', 'utility', 10),
    ('exact', 'time', 'utility', 10),
    ('exact', 'web_fetch', 'research', 10),
    ('exact', 'web_search', 'research', 10),
    ('exact', 'search_query', 'research', 10),
    ('exact', 'image_query', 'research', 10),
    ('exact', 'weather', 'research', 10),
    ('exact', 'finance', 'research', 10),
    ('exact', 'sports', 'research', 10),
    ('exact', 'task', 'delegate', 10),
    ('exact', 'spawn_agent', 'delegate', 10),
    ('exact', 'send_input', 'delegate', 10),
    ('exact', 'wait_agent', 'delegate', 10),
    ('exact', 'close_agent', 'delegate', 10),
    ('exact', 'resume_agent', 'delegate', 10),
    ('exact', 'todo_write', 'workflow', 10),
    ('exact', 'update_plan', 'workflow', 10),
    ('exact', 'request_user_input', 'workflow', 10),
    ('exact', 'parallel', 'workflow', 10),
    ('prefix', '_create', 'workflow', 20),
    ('prefix', '_update', 'workflow', 20),
    ('prefix', '_delete', 'workflow', 20),
    ('prefix', '_add', 'workflow', 20),
    ('prefix', '_remove', 'workflow', 20),
    ('prefix', '_reply', 'workflow', 20),
    ('prefix', '_request', 'workflow', 20),
    ('prefix', '_resolve', 'workflow', 20),
    ('prefix', '_merge', 'workflow', 20),
    ('prefix', '_label', 'workflow', 20),
    ('prefix', '_mark', 'workflow', 20),
    ('prefix', '_convert', 'workflow', 20),
    ('prefix', '_enable', 'workflow', 20),
    ('prefix', '_dismiss', 'workflow', 20),
    ('prefix', '_lock', 'workflow', 20),
    ('prefix', '_unlock', 'workflow', 20),
    ('prefix', '_fetch', 'research', 20),
    ('prefix', '_get', 'research', 20),
    ('prefix', '_list', 'research', 20),
    ('prefix', '_search', 'research', 20)
ON CONFLICT (match_kind, pattern) DO UPDATE
SET operation_category = EXCLUDED.operation_category,
    precedence = EXCLUDED.precedence;

DROP INDEX IF EXISTS event_blocks_operation_category_idx;

ALTER TABLE event_blocks
    DROP COLUMN IF EXISTS operation_category;
