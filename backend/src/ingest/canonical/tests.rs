use serde_json::{json, Value};

use super::*;

fn parse_claude(v: Value) -> CanonicalEvent {
    ClaudeParser.parse(&v)
}

fn parse_codex(v: Value) -> CanonicalEvent {
    CodexParser.parse(&v)
}

#[test]
fn tool_names_canonicalise() {
    assert_eq!(canonicalize_tool_name("Read"), "read");
    assert_eq!(canonicalize_tool_name("Edit"), "edit");
    assert_eq!(canonicalize_tool_name("MultiEdit"), "multi_edit");
    assert_eq!(canonicalize_tool_name("read_file"), "read");
    assert_eq!(canonicalize_tool_name("apply_patch"), "apply_patch");
    assert_eq!(canonicalize_tool_name("Bash"), "bash");
    assert_eq!(canonicalize_tool_name("WebFetch"), "web_fetch");
    // Unknown → snake_case
    assert_eq!(canonicalize_tool_name("SomeNewThing"), "some_new_thing");
    assert_eq!(canonicalize_tool_name("custom-tool"), "custom_tool");
    assert_eq!(canonicalize_tool_name("already_snake"), "already_snake");
}

#[test]
fn claude_user_text_string_content() {
    let ev = parse_claude(json!({
        "type": "user",
        "message": { "role": "user", "content": "hello world" }
    }));
    assert_eq!(ev.speaker, Speaker::User);
    assert_eq!(ev.content_kind, ContentKind::Text);
    assert_eq!(ev.blocks.len(), 1);
    assert_eq!(ev.blocks[0].kind, BlockKind::Text);
    assert_eq!(ev.blocks[0].text.as_deref(), Some("hello world"));
}

#[test]
fn claude_assistant_text_array() {
    let ev = parse_claude(json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [
            { "type": "text", "text": "first" },
            { "type": "text", "text": "second" }
        ]}
    }));
    assert_eq!(ev.speaker, Speaker::Assistant);
    assert_eq!(ev.content_kind, ContentKind::Text);
    assert_eq!(ev.blocks.len(), 2);
    assert_eq!(ev.blocks[0].text.as_deref(), Some("first"));
    assert_eq!(ev.blocks[1].text.as_deref(), Some("second"));
    assert_eq!(ev.blocks[1].ord, 1);
}

#[test]
fn claude_tool_use_canonical_name_applied() {
    let ev = parse_claude(json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [
            { "type": "tool_use", "id": "t1", "name": "Read",
              "input": { "file_path": "/a/b.rs" }}
        ]}
    }));
    assert_eq!(ev.content_kind, ContentKind::ToolUse);
    let b = &ev.blocks[0];
    assert_eq!(b.kind, BlockKind::ToolUse);
    assert_eq!(b.tool_id.as_deref(), Some("t1"));
    assert_eq!(b.tool_name.as_deref(), Some("Read"));
    assert_eq!(b.tool_name_canonical.as_deref(), Some("read"));
    assert_eq!(
        b.tool_input
            .as_ref()
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str()),
        Some("/a/b.rs")
    );
}

#[test]
fn claude_event_metadata_is_canonicalised() {
    let ev = parse_claude(json!({
        "type": "system",
        "uuid": "ev-1",
        "parentUuid": "ev-0",
        "tool_use_id": "task-1",
        "isSidechain": true,
        "isMeta": true,
        "subtype": "permission-mode"
    }));
    assert_eq!(ev.event_uuid.as_deref(), Some("ev-1"));
    assert_eq!(ev.parent_event_uuid.as_deref(), Some("ev-0"));
    assert_eq!(ev.related_tool_use_id.as_deref(), Some("task-1"));
    assert!(ev.is_sidechain);
    assert!(ev.is_meta);
    assert_eq!(ev.subtype.as_deref(), Some("permission-mode"));
}

#[test]
fn claude_tool_result_is_error_and_text_variants() {
    // string content
    let ev = parse_claude(json!({
        "type": "user",
        "message": { "role": "user", "content": [
            { "type": "tool_result", "tool_use_id": "t1", "content": "out",
              "is_error": false }
        ]}
    }));
    assert_eq!(ev.content_kind, ContentKind::ToolResult);
    assert_eq!(ev.blocks[0].kind, BlockKind::ToolResult);
    assert_eq!(ev.blocks[0].text.as_deref(), Some("out"));
    assert_eq!(ev.blocks[0].is_error, Some(false));

    // array content
    let ev = parse_claude(json!({
        "type": "user",
        "message": { "role": "user", "content": [
            { "type": "tool_result", "tool_use_id": "t2",
              "content": [
                  { "type": "text", "text": "a" },
                  { "type": "text", "text": "b" }
              ],
              "is_error": true }
        ]}
    }));
    assert_eq!(ev.blocks[0].text.as_deref(), Some("a\nb"));
    assert_eq!(ev.blocks[0].is_error, Some(true));
}

#[test]
fn claude_tool_result_attaches_canonical_payload() {
    let ev = parse_claude(json!({
        "type": "user",
        "message": { "role": "user", "content": [
            { "type": "tool_result", "tool_use_id": "edit-1", "content": "", "is_error": false }
        ]},
        "toolUseResult": {
            "filePath": "src/lib.rs",
            "oldString": "hello",
            "newString": "hello world",
            "replaceAll": true,
            "structuredPatch": [
                { "oldString": "hello", "newString": "hello world" }
            ]
        }
    }));
    let payload = ev.blocks[0].tool_output.as_ref().expect("tool output");
    assert_eq!(
        payload.get("path").and_then(|value| value.as_str()),
        Some("src/lib.rs")
    );
    assert_eq!(
        payload.get("old_text").and_then(|value| value.as_str()),
        Some("hello")
    );
    assert_eq!(
        payload.get("new_text").and_then(|value| value.as_str()),
        Some("hello world")
    );
    assert_eq!(
        payload.get("replace_all").and_then(|value| value.as_bool()),
        Some(true)
    );
    assert_eq!(
        payload
            .get("structured_patch")
            .and_then(|value| value.as_array())
            .and_then(|values| values.first())
            .and_then(|value| value.get("old_text"))
            .and_then(|value| value.as_str()),
        Some("hello")
    );
}

#[test]
fn claude_mixed_content_reports_mixed() {
    let ev = parse_claude(json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [
            { "type": "text", "text": "thinking through" },
            { "type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}},
        ]}
    }));
    assert_eq!(ev.content_kind, ContentKind::Mixed);
    assert_eq!(ev.blocks.len(), 2);
}

#[test]
fn claude_unknown_block_preserved() {
    let ev = parse_claude(json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [
            { "type": "hypothetical_future_block", "payload": { "x": 1 } }
        ]}
    }));
    assert_eq!(ev.blocks.len(), 1);
    assert_eq!(ev.blocks[0].kind, BlockKind::Unknown);
    assert!(ev.blocks[0].raw.is_some());
}

#[test]
fn claude_summary_event() {
    let ev = parse_claude(json!({
        "type": "summary",
        "summary": "compact summary text"
    }));
    assert_eq!(ev.speaker, Speaker::Summary);
    assert_eq!(ev.blocks.len(), 1);
    assert_eq!(ev.blocks[0].text.as_deref(), Some("compact summary text"));
    assert_eq!(ev.content_kind, ContentKind::Text);
}

#[test]
fn search_text_uses_canonical_tool_input() {
    let ev = parse_claude(json!({
        "type": "assistant",
        "subtype": "tool-preview",
        "message": { "role": "assistant", "content": [
            { "type": "text", "text": "reading now" },
            { "type": "tool_use", "id": "t1", "name": "Read",
              "input": { "file_path": "/tmp/a.txt", "offset": 10 }}
        ]}
    }));
    let search = ev.search_text();
    assert!(search.contains("tool-preview"));
    assert!(search.contains("reading now"));
    assert!(search.contains("read"));
    assert!(search.contains("/tmp/a.txt"));
    assert!(!search.contains("file_path"));
}

#[test]
fn codex_message_maps_to_text_blocks() {
    let ev = parse_codex(json!({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "content": [
                { "type": "output_text", "text": "a codex reply" }
            ]
        }
    }));
    assert_eq!(ev.agent, "codex");
    assert_eq!(ev.speaker, Speaker::Assistant);
    assert_eq!(ev.blocks.len(), 1);
    assert_eq!(ev.blocks[0].kind, BlockKind::Text);
    assert_eq!(ev.blocks[0].text.as_deref(), Some("a codex reply"));
}

#[test]
fn codex_top_level_kind_alias_is_accepted() {
    let ev = parse_codex(json!({
        "kind": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "content": [
                { "type": "output_text", "text": "kind alias works" }
            ]
        }
    }));
    assert_eq!(ev.speaker, Speaker::Assistant);
    assert_eq!(ev.content_kind, ContentKind::Text);
    assert_eq!(ev.blocks[0].text.as_deref(), Some("kind alias works"));
}

#[test]
fn codex_function_call_and_output_map_to_tool_blocks() {
    let ev = parse_codex(json!({
        "type": "response_item",
        "payload": {
            "type": "function_call",
            "name": "exec_command",
            "call_id": "call-1",
            "arguments": "{\"cmd\":\"git status --short\",\"workdir\":\"/tmp/demo\"}"
        }
    }));
    assert_eq!(ev.speaker, Speaker::Assistant);
    assert_eq!(ev.content_kind, ContentKind::ToolUse);
    assert_eq!(ev.blocks[0].kind, BlockKind::ToolUse);
    assert_eq!(ev.blocks[0].tool_id.as_deref(), Some("call-1"));
    assert_eq!(
        ev.blocks[0].tool_name_canonical.as_deref(),
        Some("exec_command")
    );
    assert_eq!(
        ev.blocks[0]
            .tool_input
            .as_ref()
            .and_then(|v| v.get("cmd"))
            .and_then(|v| v.as_str()),
        Some("git status --short")
    );

    let ev = parse_codex(json!({
        "type": "response_item",
        "payload": {
            "type": "function_call_output",
            "call_id": "call-1",
            "output": "ok"
        }
    }));
    assert_eq!(ev.content_kind, ContentKind::ToolResult);
    assert_eq!(ev.related_tool_use_id.as_deref(), Some("call-1"));
    assert_eq!(ev.blocks[0].kind, BlockKind::ToolResult);
    assert_eq!(ev.blocks[0].tool_id.as_deref(), Some("call-1"));
    assert_eq!(ev.blocks[0].text.as_deref(), Some("ok"));
}

#[test]
fn codex_reasoning_and_meta_records_are_preserved() {
    let ev = parse_codex(json!({
        "type": "response_item",
        "payload": {
            "type": "reasoning",
            "summary": []
        }
    }));
    assert_eq!(ev.speaker, Speaker::Assistant);
    assert_eq!(ev.content_kind, ContentKind::Thinking);
    assert_eq!(ev.blocks[0].kind, BlockKind::Thinking);

    let ev = parse_codex(json!({
        "type": "session_meta",
        "payload": { "id": "abc" }
    }));
    assert_eq!(ev.speaker, Speaker::System);
    assert!(ev.is_meta);
    assert_eq!(ev.subtype.as_deref(), Some("session_meta"));
    assert!(ev.blocks.is_empty());
}

#[test]
fn empty_thinking_still_a_thinking_block() {
    // Claude emits signature-only thinking; the frontend filters
    // these out for chip rendering, but the block must still exist
    // so other consumers (counters, future export formats) can see
    // that thinking happened.
    let ev = parse_claude(json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [
            { "type": "thinking", "thinking": "" }
        ]}
    }));
    assert_eq!(ev.blocks[0].kind, BlockKind::Thinking);
    assert_eq!(ev.blocks[0].text.as_deref(), Some(""));
}
