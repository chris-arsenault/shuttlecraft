//! App-shaped timeline projection.
//!
//! History rows are still the canonical, agent-agnostic transcript
//! surface. The timeline module projects those low-level events into
//! product concepts: turns, paired operations, visible detail chunks,
//! previews, and nested subagent runs.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::canonical::{Block, BlockKind, OperationCategory};
use crate::db::Pool;

const BOOKKEEPING_KINDS: &[&str] = &[
    "file-history-snapshot",
    "permission-mode",
    "last-prompt",
    "queue-operation",
    "attachment",
];

#[derive(Debug, Clone)]
pub struct StoredEvent {
    pub byte_offset: i64,
    pub timestamp: DateTime<Utc>,
    pub kind: String,
    pub agent: String,
    pub speaker: Option<String>,
    pub content_kind: Option<String>,
    pub event_uuid: Option<String>,
    pub parent_event_uuid: Option<String>,
    pub related_tool_use_id: Option<String>,
    pub is_sidechain: bool,
    pub is_meta: bool,
    pub subtype: Option<String>,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone)]
pub struct ResolvedSession {
    pub session_uuid: Uuid,
    pub session_agent: Option<String>,
}

#[derive(Debug, Clone)]
pub enum SessionLookup {
    MissingPty,
    NoSession,
    Resolved(ResolvedSession),
}

#[derive(Debug, Clone, Default)]
pub struct SessionEventFilter {
    pub after: Option<i64>,
    pub limit: Option<i64>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpeakerFacet {
    User,
    Assistant,
    ToolResult,
}

#[derive(Debug, Clone)]
pub struct ProjectionFilters {
    pub hidden_speakers: HashSet<SpeakerFacet>,
    pub hidden_operation_categories: HashSet<OperationCategory>,
    pub errors_only: bool,
    pub show_bookkeeping: bool,
    pub show_sidechain: bool,
    pub file_path: String,
}

impl Default for ProjectionFilters {
    fn default() -> Self {
        Self {
            hidden_speakers: HashSet::new(),
            hidden_operation_categories: HashSet::new(),
            errors_only: false,
            show_bookkeeping: false,
            show_sidechain: false,
            file_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineResponse {
    pub session_uuid: Option<Uuid>,
    pub session_agent: Option<String>,
    pub total_event_count: i64,
    pub turns: Vec<TimelineTurn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineTurn {
    pub id: i64,
    pub preview: String,
    pub user_prompt_text: Option<String>,
    pub start_timestamp: DateTime<Utc>,
    pub end_timestamp: DateTime<Utc>,
    pub duration_ms: i64,
    pub event_count: usize,
    pub operation_count: usize,
    pub tool_pairs: Vec<TimelineToolPair>,
    pub thinking_count: usize,
    pub has_errors: bool,
    pub markdown: String,
    pub chunks: Vec<TimelineChunk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineToolPair {
    pub id: String,
    pub name: String,
    pub raw_name: Option<String>,
    pub category: Option<OperationCategory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<TimelineToolResult>,
    pub is_error: bool,
    pub is_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent: Option<Box<TimelineSubagent>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineToolResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineSubagent {
    pub title: String,
    pub event_count: usize,
    pub turns: Vec<TimelineTurn>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimelineChunk {
    Assistant {
        items: Vec<TimelineAssistantItem>,
        thinking: Vec<String>,
    },
    Tool {
        pair_id: String,
    },
    Summary {
        subtype: Option<String>,
        text: String,
    },
    System {
        subtype: Option<String>,
        text: String,
        is_meta: bool,
    },
    Generic {
        label: String,
        details: TimelineGenericDetails,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimelineAssistantItem {
    Text { text: String },
    Tool { pair_id: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineGenericDetails {
    pub event_uuid: Option<String>,
    pub parent_event_uuid: Option<String>,
    pub related_tool_use_id: Option<String>,
    pub subtype: Option<String>,
    pub speaker: Option<String>,
    pub content_kind: Option<String>,
    pub blocks: Vec<Block>,
}

pub async fn resolve_session_target(
    pool: &Pool,
    pty_id: Uuid,
    explicit_session: Option<Uuid>,
) -> Result<SessionLookup, sqlx::Error> {
    let session_uuid = match explicit_session {
        Some(uuid) => Some(uuid),
        None => {
            let row: Option<(Option<Uuid>,)> =
                sqlx::query_as("SELECT current_session_uuid FROM pty_sessions WHERE id = $1")
                    .bind(pty_id)
                    .fetch_optional(pool)
                    .await?;
            match row {
                Some((Some(uuid),)) => Some(uuid),
                Some((None,)) => None,
                None => return Ok(SessionLookup::MissingPty),
            }
        }
    };

    let Some(session_uuid) = session_uuid else {
        return Ok(SessionLookup::NoSession);
    };

    let session_agent: Option<(String,)> =
        sqlx::query_as("SELECT agent FROM claude_sessions WHERE session_uuid = $1")
            .bind(session_uuid)
            .fetch_optional(pool)
            .await?;

    Ok(SessionLookup::Resolved(ResolvedSession {
        session_uuid,
        session_agent: session_agent.map(|(agent,)| agent),
    }))
}

pub async fn count_session_events(pool: &Pool, session_uuid: Uuid) -> Result<i64, sqlx::Error> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE session_uuid = $1")
        .bind(session_uuid)
        .fetch_one(pool)
        .await?;
    Ok(count)
}

pub async fn load_session_events(
    pool: &Pool,
    session_uuid: Uuid,
    filter: &SessionEventFilter,
) -> Result<Vec<StoredEvent>, sqlx::Error> {
    type HistoryRow = (
        i64,
        DateTime<Utc>,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        bool,
        bool,
        Option<String>,
    );

    let after = filter.after.unwrap_or(-1);
    let limit = filter.limit.unwrap_or(5000).clamp(1, 5000);

    let rows: Vec<HistoryRow> = if let Some(kind) = &filter.kind {
        sqlx::query_as(
            "SELECT byte_offset, timestamp, kind, agent, speaker, content_kind, \
                    event_uuid, parent_event_uuid, related_tool_use_id, is_sidechain, is_meta, subtype \
               FROM events \
              WHERE session_uuid = $1 AND byte_offset > $2 AND kind = $3 \
              ORDER BY byte_offset ASC \
              LIMIT $4",
        )
        .bind(session_uuid)
        .bind(after)
        .bind(kind)
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT byte_offset, timestamp, kind, agent, speaker, content_kind, \
                    event_uuid, parent_event_uuid, related_tool_use_id, is_sidechain, is_meta, subtype \
               FROM events \
              WHERE session_uuid = $1 AND byte_offset > $2 \
              ORDER BY byte_offset ASC \
              LIMIT $3",
        )
        .bind(session_uuid)
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    let blocks_by_offset =
        load_event_blocks(pool, session_uuid, rows.iter().map(|row| row.0)).await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                byte_offset,
                timestamp,
                kind,
                agent,
                speaker,
                content_kind,
                event_uuid,
                parent_event_uuid,
                related_tool_use_id,
                is_sidechain,
                is_meta,
                subtype,
            )| StoredEvent {
                byte_offset,
                timestamp,
                kind,
                agent,
                speaker,
                content_kind,
                event_uuid,
                parent_event_uuid,
                related_tool_use_id,
                is_sidechain,
                is_meta,
                subtype,
                blocks: blocks_by_offset
                    .get(&byte_offset)
                    .cloned()
                    .unwrap_or_default(),
            },
        )
        .collect())
}

#[derive(FromRow)]
struct EventBlockRow {
    byte_offset: i64,
    ord: i32,
    kind: String,
    text: Option<String>,
    tool_id: Option<String>,
    tool_name: Option<String>,
    tool_name_canonical: Option<String>,
    operation_category: Option<String>,
    tool_input: Option<Value>,
    is_error: Option<bool>,
}

async fn load_event_blocks(
    pool: &Pool,
    session_uuid: Uuid,
    offsets: impl Iterator<Item = i64>,
) -> Result<HashMap<i64, Vec<Block>>, sqlx::Error> {
    let list: Vec<i64> = offsets.collect();
    if list.is_empty() {
        return Ok(HashMap::new());
    }

    let rows: Vec<EventBlockRow> = sqlx::query_as(
        "SELECT b.byte_offset, b.ord, b.kind, b.text, b.tool_id, b.tool_name, \
                b.tool_name_canonical, \
                CASE \
                    WHEN b.kind = 'tool_use' THEN COALESCE(rule.operation_category, 'other') \
                    ELSE NULL \
                END AS operation_category, \
                b.tool_input, b.is_error \
           FROM event_blocks b \
           LEFT JOIN LATERAL ( \
                SELECT r.operation_category \
                  FROM tool_category_rules r \
                 WHERE ( \
                        r.match_kind = 'exact' \
                    AND r.pattern = regexp_replace(COALESCE(b.tool_name_canonical, b.tool_name, ''), '^.*\\.', '') \
                 ) OR ( \
                        r.match_kind = 'prefix' \
                    AND regexp_replace(COALESCE(b.tool_name_canonical, b.tool_name, ''), '^.*\\.', '') LIKE r.pattern || '%' \
                 ) \
                 ORDER BY r.precedence ASC \
                 LIMIT 1 \
           ) rule ON TRUE \
          WHERE b.session_uuid = $1 AND b.byte_offset = ANY($2) \
          ORDER BY b.byte_offset ASC, b.ord ASC",
    )
    .bind(session_uuid)
    .bind(&list)
    .fetch_all(pool)
    .await?;

    let mut out = HashMap::new();
    for row in rows {
        let kind = match row.kind.as_str() {
            "text" => BlockKind::Text,
            "thinking" => BlockKind::Thinking,
            "tool_use" => BlockKind::ToolUse,
            "tool_result" => BlockKind::ToolResult,
            _ => BlockKind::Unknown,
        };
        out.entry(row.byte_offset)
            .or_insert_with(Vec::new)
            .push(Block {
                ord: row.ord,
                kind,
                text: row.text,
                tool_id: row.tool_id,
                tool_name: row.tool_name,
                tool_name_canonical: row.tool_name_canonical,
                operation_category: row
                    .operation_category
                    .as_deref()
                    .and_then(OperationCategory::from_str),
                tool_input: row.tool_input,
                is_error: row.is_error,
                raw: None,
            });
    }
    Ok(out)
}

pub fn project_timeline(
    events: &[StoredEvent],
    total_event_count: i64,
    filters: &ProjectionFilters,
) -> TimelineResponse {
    let filtered_events: Vec<&StoredEvent> = events
        .iter()
        .filter(|event| filters.show_bookkeeping || !is_bookkeeping_event(event))
        .filter(|event| filters.show_sidechain || !event.is_sidechain)
        .collect();

    let turns = project_turns(&filtered_events, events, filters, true)
        .into_iter()
        .filter(|turn| turn_matches_filters(turn, filters))
        .collect();

    TimelineResponse {
        session_uuid: None,
        session_agent: None,
        total_event_count,
        turns,
    }
}

fn project_turns(
    events: &[&StoredEvent],
    all_events: &[StoredEvent],
    filters: &ProjectionFilters,
    include_subagent_links: bool,
) -> Vec<TimelineTurn> {
    group_into_turns(events)
        .into_iter()
        .map(|turn| project_turn(turn, all_events, filters, include_subagent_links))
        .collect()
}

struct TurnSeed<'a> {
    id: i64,
    user_prompt: Option<&'a StoredEvent>,
    events: Vec<&'a StoredEvent>,
    start_timestamp: DateTime<Utc>,
    end_timestamp: DateTime<Utc>,
    duration_ms: i64,
}

fn group_into_turns<'a>(events: &[&'a StoredEvent]) -> Vec<TurnSeed<'a>> {
    let mut turns = Vec::new();
    let mut current_idx: Option<usize> = None;

    for event in events.iter().copied() {
        if is_real_user_prompt(event) {
            turns.push(new_turn(Some(event), None));
            current_idx = Some(turns.len() - 1);
            continue;
        }

        if current_idx.is_none() {
            turns.push(new_turn(None, Some(event)));
            current_idx = Some(turns.len() - 1);
        }

        let turn = &mut turns[current_idx.expect("turn exists")];
        turn.events.push(event);
        turn.end_timestamp = event.timestamp;
        turn.duration_ms = duration_ms_between(turn.start_timestamp, turn.end_timestamp);
    }

    turns
}

fn new_turn<'a>(prompt: Option<&'a StoredEvent>, seed: Option<&'a StoredEvent>) -> TurnSeed<'a> {
    let first = prompt.or(seed).expect("turn needs prompt or seed");
    TurnSeed {
        id: first.byte_offset,
        user_prompt: prompt,
        events: prompt.into_iter().collect(),
        start_timestamp: first.timestamp,
        end_timestamp: first.timestamp,
        duration_ms: 0,
    }
}

fn project_turn(
    turn: TurnSeed<'_>,
    all_events: &[StoredEvent],
    filters: &ProjectionFilters,
    include_subagent_links: bool,
) -> TimelineTurn {
    let mut tool_pairs = Vec::new();
    let mut results: HashMap<String, (ToolResultView, &StoredEvent)> = HashMap::new();
    let mut use_order = 0_usize;
    let mut ordered_uses = Vec::new();
    let mut thinking_count = 0_usize;
    let mut has_errors = false;

    for event in turn.events.iter().copied() {
        if is_assistant_event(event) {
            for tool in tool_uses_in(event) {
                let id = tool
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("noid-{use_order}"));
                ordered_uses.push((id, tool, event));
                use_order += 1;
            }
            if has_useful_thinking(event) {
                thinking_count += 1;
            }
        }

        if is_tool_result_event(event) {
            for result in tool_results_in(event) {
                let id = result
                    .tool_use_id
                    .clone()
                    .unwrap_or_else(|| format!("noid-{use_order}"));
                if result.is_error {
                    has_errors = true;
                }
                results.insert(id, (result, event));
            }
        }
    }

    for (id, tool, event) in ordered_uses {
        let result_match = results.get(&id).cloned();

        let mut pair = TimelineToolPair {
            id: id.clone(),
            name: tool.name,
            raw_name: tool.raw_name,
            category: tool.category,
            input: tool.input,
            result: result_match.as_ref().map(|(result, _)| TimelineToolResult {
                content: result.content.clone(),
                is_error: result.is_error,
            }),
            is_error: result_match
                .as_ref()
                .map(|(result, _)| result.is_error)
                .unwrap_or(false),
            is_pending: result_match.is_none(),
            subagent: None,
        };

        if include_subagent_links && pair.name == "task" && !pair.id.is_empty() {
            pair.subagent =
                project_subagent(all_events, &pair, event.event_uuid.as_deref()).map(Box::new);
        }

        tool_pairs.push(pair);
    }

    let pair_by_id: HashMap<&str, &TimelineToolPair> = tool_pairs
        .iter()
        .map(|pair| (pair.id.as_str(), pair))
        .collect();
    let markdown = format_turn_markdown(turn.user_prompt, &turn.events, &pair_by_id);
    let chunks = build_chunks(turn.user_prompt, &turn.events, &pair_by_id, filters);

    TimelineTurn {
        id: turn.id,
        preview: turn_preview(turn.user_prompt, &turn.events),
        user_prompt_text: turn.user_prompt.map(user_prompt_text),
        start_timestamp: turn.start_timestamp,
        end_timestamp: turn.end_timestamp,
        duration_ms: turn.duration_ms,
        event_count: turn.events.len(),
        operation_count: tool_pairs.len(),
        tool_pairs,
        thinking_count,
        has_errors,
        markdown,
        chunks,
    }
}

fn build_chunks(
    user_prompt: Option<&StoredEvent>,
    events: &[&StoredEvent],
    pair_by_id: &HashMap<&str, &TimelineToolPair>,
    filters: &ProjectionFilters,
) -> Vec<TimelineChunk> {
    #[derive(Default)]
    struct PendingAssistant {
        items: Vec<TimelineAssistantItem>,
        thinking: Vec<String>,
        has_text: bool,
    }

    let mut chunks = Vec::new();
    let mut pending = PendingAssistant::default();

    let flush_pending = |chunks: &mut Vec<TimelineChunk>, pending: &mut PendingAssistant| {
        if pending.has_text || !pending.thinking.is_empty() {
            chunks.push(TimelineChunk::Assistant {
                items: std::mem::take(&mut pending.items),
                thinking: std::mem::take(&mut pending.thinking),
            });
        } else {
            pending.items.clear();
            pending.thinking.clear();
        }
        pending.has_text = false;
    };

    for event in events.iter().copied() {
        if user_prompt.is_some_and(|prompt| std::ptr::eq(prompt, event)) {
            continue;
        }
        if is_tool_result_event(event) {
            continue;
        }
        if !event_is_visible(event, filters) {
            continue;
        }

        if is_assistant_event(event) {
            let mut visible_pairs = Vec::new();
            for block in &event.blocks {
                match block.kind {
                    BlockKind::Text => {
                        if let Some(text) = block.text.as_ref().filter(|text| !text.is_empty()) {
                            pending
                                .items
                                .push(TimelineAssistantItem::Text { text: text.clone() });
                            pending.has_text = true;
                        }
                    }
                    BlockKind::Thinking => {
                        if let Some(text) = block
                            .text
                            .as_ref()
                            .map(|text| text.trim())
                            .filter(|text| !text.is_empty())
                        {
                            pending.thinking.push(text.to_string());
                        }
                    }
                    BlockKind::ToolUse => {
                        let Some(pair_id) = block.tool_id.as_deref() else {
                            continue;
                        };
                        let Some(pair) = pair_by_id.get(pair_id) else {
                            continue;
                        };
                        if !tool_pair_is_visible(pair, filters) {
                            continue;
                        }
                        pending.items.push(TimelineAssistantItem::Tool {
                            pair_id: pair_id.to_string(),
                        });
                        visible_pairs.push(pair_id.to_string());
                    }
                    _ => {}
                }
            }

            if !visible_pairs.is_empty() {
                flush_pending(&mut chunks, &mut pending);
                for pair_id in visible_pairs {
                    chunks.push(TimelineChunk::Tool { pair_id });
                }
            }
            continue;
        }

        flush_pending(&mut chunks, &mut pending);
        if is_summary_event(event) {
            chunks.push(TimelineChunk::Summary {
                subtype: event.subtype.clone(),
                text: text_blocks_in(event).join(" "),
            });
        } else if is_system_event(event) {
            chunks.push(TimelineChunk::System {
                subtype: event.subtype.clone(),
                text: text_blocks_in(event).join(" "),
                is_meta: event.is_meta,
            });
        } else {
            chunks.push(TimelineChunk::Generic {
                label: event.kind.clone(),
                details: TimelineGenericDetails {
                    event_uuid: event.event_uuid.clone(),
                    parent_event_uuid: event.parent_event_uuid.clone(),
                    related_tool_use_id: event.related_tool_use_id.clone(),
                    subtype: event.subtype.clone(),
                    speaker: event.speaker.clone(),
                    content_kind: event.content_kind.clone(),
                    blocks: event.blocks.clone(),
                },
            });
        }
    }

    flush_pending(&mut chunks, &mut pending);
    chunks
}

fn project_subagent(
    all_events: &[StoredEvent],
    pair: &TimelineToolPair,
    seed_uuid: Option<&str>,
) -> Option<TimelineSubagent> {
    let selected = collect_subagent_events(all_events, &pair.id, seed_uuid);
    if selected.is_empty() {
        return None;
    }

    let turns = project_turns(&selected, all_events, &ProjectionFilters::default(), false);
    Some(TimelineSubagent {
        title: subagent_title(pair),
        event_count: selected.len(),
        turns,
    })
}

fn collect_subagent_events<'a>(
    events: &'a [StoredEvent],
    tool_use_id: &str,
    seed_uuid: Option<&str>,
) -> Vec<&'a StoredEvent> {
    let mut uuids_in_lineage = HashSet::new();
    if let Some(seed_uuid) = seed_uuid {
        uuids_in_lineage.insert(seed_uuid.to_string());
    }

    for event in events {
        if event.related_tool_use_id.as_deref() == Some(tool_use_id) {
            if let Some(uuid) = &event.event_uuid {
                uuids_in_lineage.insert(uuid.clone());
            }
        }
    }

    let mut added = true;
    while added {
        added = false;
        for event in events {
            if !event.is_sidechain {
                continue;
            }
            let Some(uuid) = &event.event_uuid else {
                continue;
            };
            if uuids_in_lineage.contains(uuid) {
                continue;
            }
            if let Some(parent) = &event.parent_event_uuid {
                if uuids_in_lineage.contains(parent) {
                    uuids_in_lineage.insert(uuid.clone());
                    added = true;
                }
            }
        }
    }

    events
        .iter()
        .filter(|event| {
            (event.is_sidechain
                && event
                    .event_uuid
                    .as_ref()
                    .map(|uuid| uuids_in_lineage.contains(uuid))
                    .unwrap_or(false))
                || event.related_tool_use_id.as_deref() == Some(tool_use_id)
        })
        .collect()
}

fn turn_matches_filters(turn: &TimelineTurn, filters: &ProjectionFilters) -> bool {
    if filters.errors_only && !turn.has_errors {
        return false;
    }

    if !filters.file_path.trim().is_empty() {
        let needle = filters.file_path.to_lowercase();
        if !turn
            .tool_pairs
            .iter()
            .any(|pair| tool_pair_matches_file_path(pair, &needle))
        {
            return false;
        }
    }

    true
}

fn tool_pair_matches_file_path(pair: &TimelineToolPair, needle: &str) -> bool {
    let Some(Value::Object(input)) = &pair.input else {
        return false;
    };

    ["path", "pattern", "command", "query", "url"]
        .iter()
        .filter_map(|key| input.get(*key))
        .filter_map(Value::as_str)
        .any(|value| value.to_lowercase().contains(needle))
}

fn event_is_visible(event: &StoredEvent, filters: &ProjectionFilters) -> bool {
    let Some(speaker) = speaker_facet_of(event) else {
        return true;
    };
    !filters.hidden_speakers.contains(&speaker)
}

fn tool_pair_is_visible(pair: &TimelineToolPair, filters: &ProjectionFilters) -> bool {
    pair.category
        .map(|category| !filters.hidden_operation_categories.contains(&category))
        .unwrap_or(true)
}

#[derive(Debug, Clone)]
struct ToolUseView {
    id: Option<String>,
    name: String,
    raw_name: Option<String>,
    category: Option<OperationCategory>,
    input: Option<Value>,
}

#[derive(Debug, Clone)]
struct ToolResultView {
    tool_use_id: Option<String>,
    content: Option<String>,
    is_error: bool,
}

fn tool_uses_in(event: &StoredEvent) -> Vec<ToolUseView> {
    event
        .blocks
        .iter()
        .filter(|block| block.kind == BlockKind::ToolUse)
        .map(|block| ToolUseView {
            id: block.tool_id.clone(),
            name: block
                .tool_name_canonical
                .clone()
                .or_else(|| block.tool_name.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            raw_name: block.tool_name.clone(),
            category: block.operation_category,
            input: block.tool_input.clone(),
        })
        .collect()
}

fn tool_results_in(event: &StoredEvent) -> Vec<ToolResultView> {
    event
        .blocks
        .iter()
        .filter(|block| block.kind == BlockKind::ToolResult)
        .map(|block| ToolResultView {
            tool_use_id: block.tool_id.clone(),
            content: block.text.clone(),
            is_error: block.is_error.unwrap_or(false),
        })
        .collect()
}

fn text_blocks_in(event: &StoredEvent) -> Vec<String> {
    event
        .blocks
        .iter()
        .filter(|block| block.kind == BlockKind::Text)
        .filter_map(|block| block.text.clone())
        .collect()
}

fn thinking_texts_in(event: &StoredEvent) -> Vec<String> {
    event
        .blocks
        .iter()
        .filter(|block| block.kind == BlockKind::Thinking)
        .filter_map(|block| block.text.as_ref().map(|text| text.trim().to_string()))
        .filter(|text| !text.is_empty())
        .collect()
}

fn has_useful_thinking(event: &StoredEvent) -> bool {
    !thinking_texts_in(event).is_empty()
}

fn is_tool_result_event(event: &StoredEvent) -> bool {
    event
        .blocks
        .iter()
        .any(|block| block.kind == BlockKind::ToolResult)
}

fn is_real_user_prompt(event: &StoredEvent) -> bool {
    event_speaker(event) == "user" && !is_tool_result_event(event)
}

fn is_assistant_event(event: &StoredEvent) -> bool {
    event_speaker(event) == "assistant"
}

fn is_summary_event(event: &StoredEvent) -> bool {
    event_speaker(event) == "summary"
}

fn is_system_event(event: &StoredEvent) -> bool {
    event_speaker(event) == "system"
}

fn is_bookkeeping_event(event: &StoredEvent) -> bool {
    BOOKKEEPING_KINDS.contains(&event.kind.as_str()) || (is_system_event(event) && event.is_meta)
}

fn speaker_facet_of(event: &StoredEvent) -> Option<SpeakerFacet> {
    let speaker = event_speaker(event);
    if speaker == "assistant" {
        Some(SpeakerFacet::Assistant)
    } else if is_tool_result_event(event) {
        Some(SpeakerFacet::ToolResult)
    } else if speaker == "user" {
        Some(SpeakerFacet::User)
    } else {
        None
    }
}

fn event_speaker(event: &StoredEvent) -> &str {
    if let Some(speaker) = &event.speaker {
        return speaker;
    }
    match event.kind.as_str() {
        "assistant" => "assistant",
        "user" => "user",
        "system" => "system",
        "summary" => "summary",
        _ => "other",
    }
}

fn user_prompt_text(event: &StoredEvent) -> String {
    text_blocks_in(event).join(" ")
}

fn turn_preview(user_prompt: Option<&StoredEvent>, events: &[&StoredEvent]) -> String {
    if let Some(prompt) = user_prompt {
        let text = user_prompt_text(prompt);
        if !text.is_empty() {
            return first_paragraph(&text, 280);
        }
    }

    if let Some(first_assistant) = events
        .iter()
        .copied()
        .find(|event| is_assistant_event(event))
    {
        let text = text_blocks_in(first_assistant).join(" ");
        if !text.is_empty() {
            return format!("(assistant) {}", first_paragraph(&text, 260));
        }
    }

    "(no user prompt)".to_string()
}

fn first_paragraph(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let paragraphs: Vec<&str> = trimmed.split("\n\n").collect();
    let first = paragraphs
        .first()
        .copied()
        .unwrap_or(trimmed)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let has_more = paragraphs
        .iter()
        .skip(1)
        .any(|part| !part.trim().is_empty());
    if first.len() <= max {
        if has_more {
            format!("{first} …")
        } else {
            first
        }
    } else {
        format!("{}…", &first[..max.saturating_sub(1)])
    }
}

fn duration_ms_between(a: DateTime<Utc>, b: DateTime<Utc>) -> i64 {
    (b - a).num_milliseconds().max(0)
}

fn format_turn_markdown(
    user_prompt: Option<&StoredEvent>,
    events: &[&StoredEvent],
    pair_by_id: &HashMap<&str, &TimelineToolPair>,
) -> String {
    let mut parts = Vec::new();
    if let Some(prompt) = user_prompt {
        let prompt_text = user_prompt_text(prompt);
        if !prompt_text.trim().is_empty() {
            parts.push(format_prompt(&prompt_text));
        }
    }

    for event in events.iter().copied() {
        if user_prompt.is_some_and(|prompt| std::ptr::eq(prompt, event)) {
            continue;
        }
        if is_tool_result_event(event) {
            continue;
        }
        if is_assistant_event(event) {
            let formatted = format_assistant_event_markdown(event, pair_by_id);
            if !formatted.is_empty() {
                parts.push(formatted);
            }
        }
    }

    parts.join("\n\n")
}

fn format_assistant_event_markdown(
    event: &StoredEvent,
    pair_by_id: &HashMap<&str, &TimelineToolPair>,
) -> String {
    let mut parts = Vec::new();
    for block in &event.blocks {
        match block.kind {
            BlockKind::Text => {
                if let Some(text) = block
                    .text
                    .as_ref()
                    .map(|text| text.trim())
                    .filter(|text| !text.is_empty())
                {
                    parts.push(text.to_string());
                }
            }
            BlockKind::ToolUse => {
                let Some(tool_id) = block.tool_id.as_deref() else {
                    continue;
                };
                if let Some(pair) = pair_by_id.get(tool_id) {
                    parts.push(format_tool_pair_markdown(pair));
                }
            }
            _ => {}
        }
    }
    parts.join("\n\n")
}

fn format_prompt(text: &str) -> String {
    let quoted = text
        .split('\n')
        .map(|line| format!("> {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("**Prompt**\n\n{quoted}")
}

fn format_tool_pair_markdown(pair: &TimelineToolPair) -> String {
    let header = format!(
        "**Tool:** `{}`{}{}",
        pair.name,
        tool_one_line(pair),
        tool_status(pair)
    );
    let input = format_tool_input(pair);
    let result = format_tool_result(pair);
    [Some(header), input, result]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn tool_status(pair: &TimelineToolPair) -> String {
    if pair.is_pending {
        " _(pending)_".to_string()
    } else if pair.is_error {
        " _(error)_".to_string()
    } else {
        String::new()
    }
}

fn tool_one_line(pair: &TimelineToolPair) -> String {
    let Some(Value::Object(input)) = &pair.input else {
        return String::new();
    };
    let pick = |key: &str| input.get(key).and_then(Value::as_str);
    let summary = match pair.name.as_str() {
        "edit" | "write" | "multi_edit" | "read" => pick("path").unwrap_or_default(),
        "bash" => pick("command").unwrap_or_default(),
        "grep" | "glob" => pick("pattern").unwrap_or_default(),
        "task" => pick("description")
            .or_else(|| pick("agent"))
            .unwrap_or_default(),
        "web_fetch" => pick("url").unwrap_or_default(),
        "web_search" => pick("query").unwrap_or_default(),
        _ => "",
    };
    if summary.is_empty() {
        String::new()
    } else {
        format!(" `{}`", truncate(summary, 160))
    }
}

fn format_tool_input(pair: &TimelineToolPair) -> Option<String> {
    let input = pair.input.as_ref()?;
    match pair.name.as_str() {
        "edit" | "write" => format_edit_input(input),
        "multi_edit" => format_multi_edit_input(input),
        "bash" => {
            let command = input
                .as_object()
                .and_then(|obj| obj.get("command"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if command.is_empty() {
                None
            } else {
                Some(fence("bash", command.to_string()))
            }
        }
        "todo_write" => {
            let todos = input
                .as_object()
                .and_then(|obj| obj.get("todos"))
                .and_then(Value::as_array)?;
            if todos.is_empty() {
                return None;
            }
            Some(
                todos
                    .iter()
                    .filter_map(|todo| todo.as_object())
                    .map(|todo| {
                        let status = match todo.get("status").and_then(Value::as_str) {
                            Some("completed") => "[x]",
                            Some("in_progress") => "[~]",
                            _ => "[ ]",
                        };
                        let content = todo
                            .get("content")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        format!("- {status} {content}")
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        }
        _ => Some(fence(
            "json",
            serde_json::to_string_pretty(input).unwrap_or_else(|_| "{}".to_string()),
        )),
    }
}

fn format_edit_input(input: &Value) -> Option<String> {
    let obj = input.as_object()?;
    let old_text = obj
        .get("old_text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let new_text = if obj.contains_key("new_text") {
        obj.get("new_text")
            .and_then(Value::as_str)
            .unwrap_or_default()
    } else {
        obj.get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
    };
    if old_text.is_empty() && new_text.is_empty() {
        None
    } else {
        Some(fence("diff", unified_diff(old_text, new_text)))
    }
}

fn format_multi_edit_input(input: &Value) -> Option<String> {
    let edits = input
        .as_object()
        .and_then(|obj| obj.get("edits"))
        .and_then(Value::as_array)?;
    if edits.is_empty() {
        return None;
    }
    let diffs = edits
        .iter()
        .filter_map(|edit| edit.as_object())
        .map(|edit| {
            let old_text = edit
                .get("old_text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let new_text = edit
                .get("new_text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            unified_diff(old_text, new_text)
        })
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");
    Some(fence("diff", diffs))
}

fn format_tool_result(pair: &TimelineToolPair) -> Option<String> {
    let result = pair.result.as_ref()?;
    let body = result.content.as_deref().unwrap_or_default();
    if body.is_empty() {
        return None;
    }
    let truncated = if body.len() > 1500 {
        format!("{}\n… ({} chars total)", &body[..1500], body.len())
    } else {
        body.to_string()
    };
    let label = if pair.is_error {
        "Result (error)"
    } else {
        "Result"
    };
    Some(format!("_{label}_\n\n{}", fence("", truncated)))
}

fn unified_diff(old_text: &str, new_text: &str) -> String {
    old_text
        .lines()
        .map(|line| format!("- {line}"))
        .chain(new_text.lines().map(|line| format!("+ {line}")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn fence(lang: &str, body: String) -> String {
    let fence = if body.contains("```") { "````" } else { "```" };
    format!("{fence}{lang}\n{body}\n{fence}")
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        text.to_string()
    } else {
        format!("{}…", &text[..max.saturating_sub(1)])
    }
}

fn subagent_title(pair: &TimelineToolPair) -> String {
    let Some(Value::Object(input)) = &pair.input else {
        return "Agent log".to_string();
    };
    if let Some(description) = input.get("description").and_then(Value::as_str) {
        return format!("Agent log · {description}");
    }
    if let Some(agent) = input.get("agent").and_then(Value::as_str) {
        return format!("Agent log · {agent}");
    }
    "Agent log".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn ts(sec: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(sec, 0).single().unwrap()
    }

    fn text(ord: i32, value: &str) -> Block {
        Block::text(ord, value)
    }

    fn thinking(ord: i32, value: &str) -> Block {
        Block::thinking(ord, value)
    }

    fn tool_use(
        ord: i32,
        id: &str,
        name: &str,
        category: OperationCategory,
        input: Value,
    ) -> Block {
        let mut block = Block::tool_use(ord, id, name, input);
        block.operation_category = Some(category);
        block
    }

    fn tool_result(ord: i32, id: &str, text: &str, is_error: bool) -> Block {
        Block::tool_result(ord, id, Some(text.to_string()), is_error)
    }

    fn event(byte_offset: i64, kind: &str, blocks: Vec<Block>) -> StoredEvent {
        StoredEvent {
            byte_offset,
            timestamp: ts(byte_offset),
            kind: kind.to_string(),
            agent: "claude-code".to_string(),
            speaker: Some(
                match kind {
                    "assistant" => "assistant",
                    "user" => "user",
                    "system" => "system",
                    "summary" => "summary",
                    _ => "other",
                }
                .to_string(),
            ),
            content_kind: None,
            event_uuid: Some(format!("evt-{byte_offset}")),
            parent_event_uuid: None,
            related_tool_use_id: None,
            is_sidechain: false,
            is_meta: false,
            subtype: None,
            blocks,
        }
    }

    #[test]
    fn projects_turns_and_pairs() {
        let events = vec![
            event(1, "user", vec![text(0, "hello")]),
            event(
                2,
                "assistant",
                vec![
                    text(0, "working"),
                    thinking(1, "step"),
                    tool_use(
                        2,
                        "t1",
                        "bash",
                        OperationCategory::Utility,
                        json!({"command": "ls -la"}),
                    ),
                ],
            ),
            event(3, "user", vec![tool_result(0, "t1", "done", false)]),
        ];

        let projected =
            project_timeline(&events, events.len() as i64, &ProjectionFilters::default());
        assert_eq!(projected.turns.len(), 1);
        let turn = &projected.turns[0];
        assert_eq!(turn.preview, "hello");
        assert_eq!(turn.tool_pairs.len(), 1);
        assert_eq!(turn.tool_pairs[0].name, "bash");
        assert_eq!(
            turn.tool_pairs[0]
                .result
                .as_ref()
                .unwrap()
                .content
                .as_deref(),
            Some("done")
        );
        assert_eq!(turn.thinking_count, 1);
        assert!(turn
            .chunks
            .iter()
            .any(|chunk| matches!(chunk, TimelineChunk::Tool { pair_id } if pair_id == "t1")));
    }

    #[test]
    fn hidden_categories_merge_assistant_chunks() {
        let events = vec![
            event(1, "user", vec![text(0, "prompt")]),
            event(
                2,
                "assistant",
                vec![
                    text(0, "before"),
                    tool_use(
                        1,
                        "t1",
                        "edit",
                        OperationCategory::CreateContent,
                        json!({"path": "/tmp/x"}),
                    ),
                    text(2, "after"),
                ],
            ),
        ];

        let mut filters = ProjectionFilters::default();
        filters
            .hidden_operation_categories
            .insert(OperationCategory::CreateContent);

        let projected = project_timeline(&events, events.len() as i64, &filters);
        let turn = &projected.turns[0];
        assert_eq!(turn.tool_pairs.len(), 1);
        assert_eq!(turn.chunks.len(), 1);
        match &turn.chunks[0] {
            TimelineChunk::Assistant { items, .. } => {
                assert_eq!(items.len(), 2);
            }
            other => panic!("unexpected chunk: {other:?}"),
        }
    }

    #[test]
    fn task_pairs_capture_subagent_turns() {
        let mut root = event(
            1,
            "assistant",
            vec![tool_use(
                0,
                "task-1",
                "task",
                OperationCategory::Delegate,
                json!({"description": "investigate"}),
            )],
        );
        root.event_uuid = Some("asst-1".to_string());

        let mut sub_prompt = event(2, "user", vec![text(0, "sub prompt")]);
        sub_prompt.is_sidechain = true;
        sub_prompt.parent_event_uuid = Some("asst-1".to_string());

        let mut sub_reply = event(3, "assistant", vec![text(0, "sub reply")]);
        sub_reply.is_sidechain = true;
        sub_reply.parent_event_uuid = Some("evt-2".to_string());

        let events = vec![root, sub_prompt, sub_reply];
        let projected =
            project_timeline(&events, events.len() as i64, &ProjectionFilters::default());
        let pair = &projected.turns[0].tool_pairs[0];
        let subagent = pair.subagent.as_ref().expect("subagent projected");
        assert_eq!(subagent.event_count, 2);
        assert_eq!(subagent.turns.len(), 1);
        assert_eq!(subagent.turns[0].preview, "sub prompt");
    }
}
