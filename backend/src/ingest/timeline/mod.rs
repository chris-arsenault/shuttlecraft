//! App-shaped timeline projection.
//!
//! History rows are still the canonical, agent-agnostic transcript
//! surface. The timeline module projects those low-level events into
//! product concepts: turns, paired operations, visible detail chunks,
//! previews, and nested subagent runs.

mod derived;
mod load;
mod project;
mod render;
#[cfg(test)]
mod tests;
mod types;

pub use derived::{
    build_session_projection, StoredActivitySignal, StoredOperationProjection,
    StoredReferenceProjection, StoredSearchDocument, StoredTurnProjection,
};
pub use load::{
    count_session_events, load_all_session_events, load_session_events, resolve_session_target,
};
pub use project::project_timeline;
pub use types::{
    ProjectionFilters, ResolvedSession, SessionEventFilter, SessionLookup, SpeakerFacet,
    StoredEvent, TimelineAssistantItem, TimelineChunk, TimelineGenericDetails, TimelineResponse,
    TimelineSubagent, TimelineToolPair, TimelineToolResult, TimelineTurn,
};

pub(crate) use types::BOOKKEEPING_KINDS;
