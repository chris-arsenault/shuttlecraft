use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::ingest::canonical::OperationCategory;

use super::project::{group_into_turns, project_turn};
use super::render::truncate;
use super::{ProjectionFilters, StoredEvent, TimelineChunk, TimelineTurn};

#[derive(Debug, Clone)]
pub struct StoredTurnProjection {
    pub turn_ord: i32,
    pub is_sidechain_turn: bool,
    pub search_text: String,
    pub turn: TimelineTurn,
    pub operations: Vec<StoredOperationProjection>,
    pub references: Vec<StoredReferenceProjection>,
    pub activity_signals: Vec<StoredActivitySignal>,
    pub search_documents: Vec<StoredSearchDocument>,
}

#[derive(Debug, Clone)]
pub struct StoredOperationProjection {
    pub operation_ord: i32,
    pub pair_id: String,
    pub name: String,
    pub raw_name: Option<String>,
    pub operation_type: Option<String>,
    pub operation_category: Option<OperationCategory>,
    pub input: Option<Value>,
    pub result_content: Option<String>,
    pub result_is_error: bool,
    pub is_error: bool,
    pub is_pending: bool,
    pub search_text: String,
}

#[derive(Debug, Clone)]
pub struct StoredReferenceProjection {
    pub reference_ord: i32,
    pub operation_ord: Option<i32>,
    pub reference_kind: String,
    pub value: String,
    pub normalized_value: String,
}

#[derive(Debug, Clone)]
pub struct StoredActivitySignal {
    pub signal_ord: i32,
    pub signal_type: String,
    pub signal_value: Option<String>,
    pub signal_count: i32,
}

#[derive(Debug, Clone)]
pub struct StoredSearchDocument {
    pub doc_ord: i32,
    pub doc_kind: String,
    pub operation_ord: Option<i32>,
    pub reference_ord: Option<i32>,
    pub timestamp: DateTime<Utc>,
    pub preview: String,
    pub search_text: String,
}

pub fn build_session_projection(events: &[StoredEvent]) -> Vec<StoredTurnProjection> {
    let event_refs: Vec<&StoredEvent> = events.iter().collect();
    group_into_turns(&event_refs)
        .into_iter()
        .enumerate()
        .map(|(turn_ord, seed)| {
            let is_sidechain_turn = seed
                .user_prompt
                .map(|event| event.is_sidechain)
                .or_else(|| seed.events.first().copied().map(|event| event.is_sidechain))
                .unwrap_or(false);
            let turn = project_turn(seed, events, &ProjectionFilters::default(), true);
            let operations = build_operation_projections(&turn);
            let references = build_reference_projections(&operations);
            let activity_signals = build_activity_signals(&turn, is_sidechain_turn);
            let search_text = build_turn_search_text(&turn, &operations);
            let search_documents =
                build_search_documents(&turn, &operations, &references, &activity_signals);
            StoredTurnProjection {
                turn_ord: turn_ord as i32,
                is_sidechain_turn,
                search_text,
                turn,
                operations,
                references,
                activity_signals,
                search_documents,
            }
        })
        .collect()
}

fn build_operation_projections(turn: &TimelineTurn) -> Vec<StoredOperationProjection> {
    turn.tool_pairs
        .iter()
        .enumerate()
        .map(|(operation_ord, pair)| {
            let mut parts = vec![pair.name.clone()];
            if let Some(raw_name) = pair.raw_name.as_ref().filter(|value| !value.is_empty()) {
                parts.push(raw_name.clone());
            }
            if let Some(operation_type) = pair
                .operation_type
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                parts.push(operation_type.clone());
            }
            if let Some(category) = pair.category {
                parts.push(category.as_str().to_string());
            }
            if let Some(input) = pair.input.as_ref() {
                parts.push(json_search_text(input));
            }
            if let Some(result) = pair
                .result
                .as_ref()
                .and_then(|result| result.content.clone())
            {
                parts.push(result);
            }
            StoredOperationProjection {
                operation_ord: operation_ord as i32,
                pair_id: pair.id.clone(),
                name: pair.name.clone(),
                raw_name: pair.raw_name.clone(),
                operation_type: pair.operation_type.clone(),
                operation_category: pair.category,
                input: pair.input.clone(),
                result_content: pair
                    .result
                    .as_ref()
                    .and_then(|result| result.content.clone()),
                result_is_error: pair
                    .result
                    .as_ref()
                    .map(|result| result.is_error)
                    .unwrap_or(false),
                is_error: pair.is_error,
                is_pending: pair.is_pending,
                search_text: join_non_empty(parts),
            }
        })
        .collect()
}

fn build_reference_projections(
    operations: &[StoredOperationProjection],
) -> Vec<StoredReferenceProjection> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for operation in operations {
        let Some(Value::Object(input)) = &operation.input else {
            continue;
        };
        for (reference_kind, key) in [
            ("path", "path"),
            ("pattern", "pattern"),
            ("command", "command"),
            ("command", "cmd"),
            ("query", "query"),
            ("url", "url"),
            ("description", "description"),
            ("agent", "agent"),
        ] {
            let Some(value) = input
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let dedupe_key = (
                operation.operation_ord,
                reference_kind.to_string(),
                value.to_string(),
            );
            if !seen.insert(dedupe_key) {
                continue;
            }
            out.push(StoredReferenceProjection {
                reference_ord: out.len() as i32,
                operation_ord: Some(operation.operation_ord),
                reference_kind: reference_kind.to_string(),
                value: value.to_string(),
                normalized_value: value.to_lowercase(),
            });
        }
    }

    out
}

fn build_activity_signals(
    turn: &TimelineTurn,
    is_sidechain_turn: bool,
) -> Vec<StoredActivitySignal> {
    let mut out = Vec::new();
    if turn
        .user_prompt_text
        .as_deref()
        .is_some_and(|text| !text.trim().is_empty())
    {
        out.push(new_activity_signal("speaker", Some("user".to_string()), 1));
    }

    let assistant_chunks = turn
        .chunks
        .iter()
        .filter(|chunk| matches!(chunk, TimelineChunk::Assistant { .. }))
        .count() as i32;
    if assistant_chunks > 0 {
        out.push(new_activity_signal(
            "speaker",
            Some("assistant".to_string()),
            assistant_chunks,
        ));
    }

    let tool_result_count = turn
        .tool_pairs
        .iter()
        .filter(|pair| pair.result.is_some())
        .count() as i32;
    if tool_result_count > 0 {
        out.push(new_activity_signal(
            "speaker",
            Some("tool_result".to_string()),
            tool_result_count,
        ));
    }

    let mut category_counts: HashMap<OperationCategory, i32> = HashMap::new();
    for pair in &turn.tool_pairs {
        if let Some(category) = pair.category {
            *category_counts.entry(category).or_insert(0) += 1;
        }
    }
    let mut categories = category_counts.into_iter().collect::<Vec<_>>();
    categories.sort_by_key(|(category, _)| category.as_str().to_string());
    for (category, count) in categories {
        out.push(new_activity_signal(
            "operation_category",
            Some(category.as_str().to_string()),
            count,
        ));
    }

    if turn.thinking_count > 0 {
        out.push(new_activity_signal(
            "thinking",
            None,
            turn.thinking_count as i32,
        ));
    }
    if turn.has_errors {
        let error_count = turn
            .tool_pairs
            .iter()
            .filter(|pair| pair.is_error)
            .count()
            .max(1) as i32;
        out.push(new_activity_signal("error", None, error_count));
    }
    if is_sidechain_turn {
        out.push(new_activity_signal("sidechain", None, 1));
    }

    for (idx, signal) in out.iter_mut().enumerate() {
        signal.signal_ord = idx as i32;
    }
    out
}

fn new_activity_signal(
    signal_type: &str,
    signal_value: Option<String>,
    signal_count: i32,
) -> StoredActivitySignal {
    StoredActivitySignal {
        signal_ord: 0,
        signal_type: signal_type.to_string(),
        signal_value,
        signal_count,
    }
}

fn build_search_documents(
    turn: &TimelineTurn,
    operations: &[StoredOperationProjection],
    references: &[StoredReferenceProjection],
    activity_signals: &[StoredActivitySignal],
) -> Vec<StoredSearchDocument> {
    let mut out = Vec::new();
    let timestamp = turn.start_timestamp;
    let turn_search_text = build_turn_search_text(turn, operations);
    if !turn_search_text.is_empty() {
        out.push(StoredSearchDocument {
            doc_ord: out.len() as i32,
            doc_kind: "turn".to_string(),
            operation_ord: None,
            reference_ord: None,
            timestamp,
            preview: truncate(&turn.preview, 200),
            search_text: turn_search_text,
        });
    }

    for operation in operations
        .iter()
        .filter(|operation| !operation.search_text.is_empty())
    {
        out.push(StoredSearchDocument {
            doc_ord: out.len() as i32,
            doc_kind: "operation".to_string(),
            operation_ord: Some(operation.operation_ord),
            reference_ord: None,
            timestamp,
            preview: truncate(
                format!(
                    "{} {}",
                    operation
                        .operation_type
                        .as_deref()
                        .unwrap_or(operation.name.as_str()),
                    operation
                        .raw_name
                        .as_deref()
                        .filter(|value| !value.is_empty())
                        .unwrap_or("")
                )
                .trim(),
                200,
            ),
            search_text: operation.search_text.clone(),
        });
    }

    for reference in references {
        out.push(StoredSearchDocument {
            doc_ord: out.len() as i32,
            doc_kind: "reference".to_string(),
            operation_ord: reference.operation_ord,
            reference_ord: Some(reference.reference_ord),
            timestamp,
            preview: truncate(&reference.value, 200),
            search_text: reference.value.clone(),
        });
    }

    for signal in activity_signals {
        let preview = match &signal.signal_value {
            Some(value) => format!("{}: {}", signal.signal_type, value),
            None => signal.signal_type.clone(),
        };
        out.push(StoredSearchDocument {
            doc_ord: out.len() as i32,
            doc_kind: "activity".to_string(),
            operation_ord: None,
            reference_ord: None,
            timestamp,
            preview,
            search_text: match &signal.signal_value {
                Some(value) => format!("{} {}", signal.signal_type, value),
                None => signal.signal_type.clone(),
            },
        });
    }

    out
}

fn build_turn_search_text(turn: &TimelineTurn, operations: &[StoredOperationProjection]) -> String {
    let mut parts = vec![turn.preview.clone(), turn.markdown.clone()];
    if let Some(prompt) = turn
        .user_prompt_text
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        parts.push(prompt.clone());
    }
    for operation in operations {
        if !operation.search_text.is_empty() {
            parts.push(operation.search_text.clone());
        }
    }
    join_non_empty(parts)
}

fn json_search_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn join_non_empty(parts: Vec<String>) -> String {
    parts
        .into_iter()
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
