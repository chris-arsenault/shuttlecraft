//! JSONL ingester. Sole reader of `~/.claude/projects/**/*.jsonl`. All
//! other consumers (REST, WebSocket events) query Postgres — never the
//! files directly.
//!
//! Invariants:
//!   - `ingester_state.last_committed_byte_offset` is ALWAYS at a line
//!     boundary (the byte following a newline, or 0).
//!   - Each tick reads the file from the committed offset to EOF,
//!     processes complete lines (those ending in `\n`), and advances
//!     the offset to past the final newline. A trailing partial line
//!     (no newline) is simply left for the next tick, which will re-read
//!     it from disk once the newline arrives.
//!   - Event rows are keyed on `(session_uuid, byte_offset)` and inserted
//!     with `ON CONFLICT DO NOTHING`, so crash-restarts replay safely.
//!   - Unknown event types are logged and stored with `kind = "unknown"`
//!     — the JSONL format is not a stable public API, and the timeline
//!     can render a generic fallback.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::db::Pool;

#[derive(Debug, Clone)]
pub struct IngesterConfig {
    pub projects_dir: PathBuf,
    pub poll_interval: Duration,
}

impl IngesterConfig {
    pub fn new(projects_dir: PathBuf) -> Self {
        Self {
            projects_dir,
            poll_interval: Duration::from_millis(500),
        }
    }
}

#[derive(Default)]
pub struct Ingester;

impl Ingester {
    pub fn new() -> Self {
        Self
    }

    /// Run continuously. Polls `projects_dir` on `cfg.poll_interval`. Never
    /// returns; callers should `tokio::spawn` it.
    pub async fn run(&self, pool: Pool, cfg: IngesterConfig) {
        loop {
            if let Err(err) = self.tick(&pool, &cfg).await {
                tracing::warn!(%err, "ingester tick error");
            }
            tokio::time::sleep(cfg.poll_interval).await;
        }
    }

    /// Run one pass over every JSONL file in the projects dir. Exposed
    /// so tests can drive the ingester synchronously.
    pub async fn tick(&self, pool: &Pool, cfg: &IngesterConfig) -> anyhow::Result<()> {
        if !cfg.projects_dir.exists() {
            return Ok(());
        }
        for entry in WalkDir::new(&cfg.projects_dir)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            if entry.path().extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if let Err(err) = process_file(pool, entry.path()).await {
                tracing::warn!(path = %entry.path().display(), %err, "ingest file failed");
            }
        }
        Ok(())
    }
}

async fn process_file(pool: &Pool, path: &Path) -> anyhow::Result<()> {
    let Some(session_uuid) = parse_session_uuid(path) else {
        return Ok(());
    };
    let project_hash = parse_project_hash(path);

    upsert_claude_session(pool, session_uuid, project_hash.as_deref()).await?;

    let committed = get_offset(pool, session_uuid).await?;
    let file_len = match std::fs::metadata(path) {
        Ok(md) => md.len() as i64,
        Err(_) => return Ok(()),
    };

    if file_len == committed {
        return Ok(());
    }
    if file_len < committed {
        // File truncated or replaced — reset and try again on next tick.
        tracing::warn!(
            path = %path.display(),
            file_len, committed,
            "file shorter than committed offset; resetting",
        );
        set_offset(pool, session_uuid, path, 0).await?;
        return Ok(());
    }

    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(committed as u64))?;
    let mut buf = Vec::with_capacity((file_len - committed) as usize);
    file.read_to_end(&mut buf)?;

    // Walk the buffer. For each newline-terminated line, insert an event
    // and advance `next_committed` past the newline.
    let mut line_start: usize = 0;
    let mut next_committed = committed;

    for (i, &b) in buf.iter().enumerate() {
        if b != b'\n' {
            continue;
        }
        let line = &buf[line_start..i];
        let byte_offset = committed + line_start as i64;
        if let Err(err) = insert_event(pool, session_uuid, byte_offset, line).await {
            tracing::warn!(%err, byte_offset, "insert_event failed");
        }
        line_start = i + 1;
        next_committed = committed + line_start as i64;
    }

    // Any tail after the last newline is a partial line. Left in the
    // file; will be re-read on the next tick once it's newline-terminated.

    if next_committed != committed {
        set_offset(pool, session_uuid, path, next_committed).await?;
    }
    Ok(())
}

fn parse_session_uuid(path: &Path) -> Option<Uuid> {
    let stem = path.file_stem()?.to_str()?;
    Uuid::parse_str(stem).ok()
}

fn parse_project_hash(path: &Path) -> Option<String> {
    path.parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

async fn upsert_claude_session(
    pool: &Pool,
    session_uuid: Uuid,
    project_hash: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO claude_sessions (session_uuid, project_hash) \
         VALUES ($1, $2) ON CONFLICT (session_uuid) DO NOTHING",
    )
    .bind(session_uuid)
    .bind(project_hash)
    .execute(pool)
    .await?;
    Ok(())
}

async fn get_offset(pool: &Pool, session_uuid: Uuid) -> anyhow::Result<i64> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT last_committed_byte_offset FROM ingester_state WHERE session_uuid = $1",
    )
    .bind(session_uuid)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(o,)| o).unwrap_or(0))
}

async fn set_offset(
    pool: &Pool,
    session_uuid: Uuid,
    path: &Path,
    offset: i64,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO ingester_state (session_uuid, file_path, last_committed_byte_offset, updated_at) \
         VALUES ($1, $2, $3, NOW()) \
         ON CONFLICT (session_uuid) DO UPDATE SET \
           file_path = EXCLUDED.file_path, \
           last_committed_byte_offset = EXCLUDED.last_committed_byte_offset, \
           updated_at = NOW()",
    )
    .bind(session_uuid)
    .bind(path.to_string_lossy().as_ref())
    .bind(offset)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_event(
    pool: &Pool,
    session_uuid: Uuid,
    byte_offset: i64,
    line: &[u8],
) -> anyhow::Result<()> {
    if line.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok(());
    }

    let value: Value = match serde_json::from_slice(line) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                %err,
                session = %session_uuid,
                byte_offset,
                "malformed JSONL line, skipping",
            );
            return Ok(());
        }
    };

    let kind = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let timestamp = value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    if kind == "unknown" {
        tracing::debug!(
            session = %session_uuid,
            byte_offset,
            "event without explicit type — stored as 'unknown'",
        );
    }

    sqlx::query(
        "INSERT INTO events (session_uuid, byte_offset, timestamp, kind, payload) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (session_uuid, byte_offset) DO NOTHING",
    )
    .bind(session_uuid)
    .bind(byte_offset)
    .bind(timestamp)
    .bind(&kind)
    .bind(&value)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_session_uuid_from_filename() {
        let uuid = Uuid::new_v4();
        let path = PathBuf::from(format!("/tmp/abc/{uuid}.jsonl"));
        assert_eq!(parse_session_uuid(&path), Some(uuid));
    }

    #[test]
    fn parse_session_uuid_none_for_non_uuid_stem() {
        let path = PathBuf::from("/tmp/abc/not-a-uuid.jsonl");
        assert_eq!(parse_session_uuid(&path), None);
    }

    #[test]
    fn parse_project_hash_is_parent_dir() {
        let path = PathBuf::from("/tmp/my-project-hash/xxx.jsonl");
        assert_eq!(parse_project_hash(&path), Some("my-project-hash".into()));
    }
}
