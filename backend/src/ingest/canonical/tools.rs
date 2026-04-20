use serde_json::{Map, Value};

pub fn canonicalize_tool_name(raw: &str) -> String {
    match raw {
        // Claude Code builtins
        "Read" | "read_file" => "read",
        "Write" | "write_file" => "write",
        "Edit" | "apply_diff" => "edit",
        "MultiEdit" => "multi_edit",
        "Bash" | "shell" | "execute_shell" => "bash",
        "Grep" | "grep_search" => "grep",
        "Glob" | "glob_files" => "glob",
        "Task" | "spawn_agent" => "task",
        "TodoWrite" | "todo_update" => "todo_write",
        "WebFetch" | "fetch_url" => "web_fetch",
        "WebSearch" | "web_search_query" => "web_search",
        "NotebookEdit" => "notebook_edit",
        "BashOutput" => "bash_output",
        "KillShell" | "killShell" => "kill_shell",
        "ExitPlanMode" | "exitPlanMode" => "exit_plan_mode",
        other => {
            // Fallback: lowercase + snake_case. Keeps unknown agents
            // pointing at something consistent.
            return to_snake_case(other);
        }
    }
    .to_string()
}

fn to_snake_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    let mut prev_lower = false;
    for c in s.chars() {
        if c.is_ascii_uppercase() {
            if prev_lower {
                out.push('_');
            }
            for lc in c.to_lowercase() {
                out.push(lc);
            }
            prev_lower = false;
        } else if c == '-' || c == ' ' {
            out.push('_');
            prev_lower = false;
        } else {
            out.push(c);
            prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        }
    }
    out
}

pub(crate) fn canonicalize_tool_input(canonical_name: &str, input: Value) -> Value {
    let Value::Object(obj) = input else {
        return input;
    };
    let mut out = Map::new();
    match canonical_name {
        "read" => {
            copy_first(&obj, &mut out, "path", &["path", "file_path"]);
            copy_key(&obj, &mut out, "offset");
            copy_key(&obj, &mut out, "limit");
        }
        "write" => {
            copy_first(&obj, &mut out, "path", &["path", "file_path"]);
            copy_key(&obj, &mut out, "content");
        }
        "edit" => {
            copy_first(&obj, &mut out, "path", &["path", "file_path"]);
            copy_first(&obj, &mut out, "old_text", &["old_text", "old_string"]);
            copy_first(&obj, &mut out, "new_text", &["new_text", "new_string"]);
            copy_key(&obj, &mut out, "replace_all");
        }
        "multi_edit" => {
            copy_first(&obj, &mut out, "path", &["path", "file_path"]);
            if let Some(Value::Array(edits)) = obj.get("edits") {
                let normalized = edits
                    .iter()
                    .map(|edit| normalize_edit(edit.clone()))
                    .collect::<Vec<_>>();
                out.insert("edits".to_string(), Value::Array(normalized));
            }
        }
        "bash" => {
            copy_key(&obj, &mut out, "command");
            copy_key(&obj, &mut out, "description");
        }
        "grep" => {
            copy_key(&obj, &mut out, "pattern");
            copy_first(&obj, &mut out, "path", &["path", "glob"]);
            copy_first(&obj, &mut out, "mode", &["mode", "output_mode"]);
        }
        "glob" => {
            copy_key(&obj, &mut out, "pattern");
            copy_key(&obj, &mut out, "path");
        }
        "task" => {
            copy_first(&obj, &mut out, "agent", &["agent", "subagent_type"]);
            copy_key(&obj, &mut out, "description");
            copy_key(&obj, &mut out, "prompt");
        }
        "todo_write" => {
            copy_key(&obj, &mut out, "todos");
        }
        "web_fetch" => {
            copy_key(&obj, &mut out, "url");
            copy_key(&obj, &mut out, "prompt");
        }
        "web_search" => {
            copy_key(&obj, &mut out, "query");
            copy_key(&obj, &mut out, "prompt");
        }
        _ => {
            return Value::Object(obj);
        }
    }
    Value::Object(out)
}

pub(crate) fn canonicalize_tool_result_payload(payload: Value) -> Value {
    normalize_result_value(payload)
}

fn normalize_edit(edit: Value) -> Value {
    let Value::Object(obj) = edit else {
        return edit;
    };
    let mut out = Map::new();
    copy_first(&obj, &mut out, "old_text", &["old_text", "old_string"]);
    copy_first(&obj, &mut out, "new_text", &["new_text", "new_string"]);
    copy_key(&obj, &mut out, "replace_all");
    Value::Object(out)
}

fn normalize_result_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(normalize_result_value)
                .collect::<Vec<_>>(),
        ),
        Value::Object(obj) => {
            let mut out = Map::with_capacity(obj.len());
            for (key, value) in obj {
                out.insert(normalize_result_key(&key), normalize_result_value(value));
            }
            Value::Object(out)
        }
        other => other,
    }
}

fn normalize_result_key(raw: &str) -> String {
    match raw {
        "filePath" | "file_path" => "path".to_string(),
        "oldString" | "old_string" => "old_text".to_string(),
        "newString" | "new_string" => "new_text".to_string(),
        "replaceAll" | "replace_all" => "replace_all".to_string(),
        "originalFile" | "original_file" => "original_file".to_string(),
        "structuredPatch" | "structured_patch" => "structured_patch".to_string(),
        "userModified" | "user_modified" => "user_modified".to_string(),
        other => to_snake_case(other),
    }
}

fn copy_first(
    src: &Map<String, Value>,
    dst: &mut Map<String, Value>,
    target: &str,
    candidates: &[&str],
) {
    for key in candidates {
        if let Some(value) = src.get(*key) {
            dst.insert(target.to_string(), value.clone());
            return;
        }
    }
}

fn copy_key(src: &Map<String, Value>, dst: &mut Map<String, Value>, key: &str) {
    if let Some(value) = src.get(key) {
        dst.insert(key.to_string(), value.clone());
    }
}
