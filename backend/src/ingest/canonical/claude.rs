use serde_json::Value;

use super::{content_kind_of, Block, CanonicalEvent, EventParser, Speaker};

pub struct ClaudeParser;

impl EventParser for ClaudeParser {
    fn agent_id(&self) -> &'static str {
        "claude-code"
    }

    fn parse(&self, value: &Value) -> CanonicalEvent {
        let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let speaker = match kind {
            "user" => Speaker::User,
            "assistant" => Speaker::Assistant,
            "system" => Speaker::System,
            "summary" => Speaker::Summary,
            _ => Speaker::Other,
        };

        // Most content lives under `message.content`. When `content` is
        // a string rather than an array (happens on some user events),
        // treat the whole string as one text block.
        let content = value.get("message").and_then(|m| m.get("content"));

        let mut blocks = match content {
            Some(Value::Array(arr)) => parse_blocks(arr),
            Some(Value::String(s)) => vec![Block::text(0, s.clone())],
            _ => Vec::new(),
        };
        if blocks.is_empty() && kind == "summary" {
            if let Some(summary) = value.get("summary").and_then(|v| v.as_str()) {
                blocks.push(Block::text(0, summary.to_string()));
            }
        }

        let content_kind = content_kind_of(&blocks);

        CanonicalEvent {
            agent: self.agent_id(),
            speaker,
            content_kind,
            event_uuid: string_field(value, &["uuid"]),
            parent_event_uuid: string_field(value, &["parentUuid", "parent_uuid"]),
            related_tool_use_id: string_field(value, &["tool_use_id"]),
            is_sidechain: bool_field(value, &["isSidechain"]).unwrap_or(false),
            is_meta: bool_field(value, &["isMeta"]).unwrap_or(false),
            subtype: string_field(value, &["subtype"]),
            blocks,
        }
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| v.as_str()))
        .map(ToString::to_string)
}

fn bool_field(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| v.as_bool()))
}

fn parse_blocks(arr: &[Value]) -> Vec<Block> {
    let mut out = Vec::with_capacity(arr.len());
    for (i, raw) in arr.iter().enumerate() {
        let ord = i as i32;
        let Some(ty) = raw.get("type").and_then(|v| v.as_str()) else {
            out.push(Block::unknown(ord, raw.clone()));
            continue;
        };
        match ty {
            "text" => {
                let text = raw
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                out.push(Block::text(ord, text));
            }
            "thinking" => {
                let text = raw
                    .get("thinking")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                out.push(Block::thinking(ord, text));
            }
            "tool_use" => {
                let id = raw
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = raw
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let input = raw.get("input").cloned().unwrap_or(Value::Null);
                out.push(Block::tool_use(ord, id, name, input));
            }
            "tool_result" => {
                let id = raw
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let is_error = raw
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                // `content` here can be a string, an array of {type:text, text}
                // blocks, or an object — flatten to a string.
                let text = match raw.get("content") {
                    Some(Value::String(s)) => Some(s.clone()),
                    Some(Value::Array(parts)) => {
                        let mut buf = String::new();
                        for p in parts {
                            if let Some(s) = p.get("text").and_then(|v| v.as_str()) {
                                if !buf.is_empty() {
                                    buf.push('\n');
                                }
                                buf.push_str(s);
                            }
                        }
                        if buf.is_empty() {
                            None
                        } else {
                            Some(buf)
                        }
                    }
                    Some(other) => Some(other.to_string()),
                    None => None,
                };
                out.push(Block::tool_result(ord, id, text, is_error));
            }
            _ => {
                out.push(Block::unknown(ord, raw.clone()));
            }
        }
    }
    out
}
