// Polls /api/sessions/:id/history → applies user-chosen filters →
// groups into turns → renders virtualized TurnBlocks. Clicking a Task
// tool inside a turn opens the subagent modal drill-in.

import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { getHistory } from "../api/client";
import type { TimelineEvent } from "../api/types";
import { FilterChips } from "./timeline/FilterChips";
import {
  eventMatchesFilters,
  useTimelineFilters,
} from "./timeline/filters";
import {
  groupIntoTurns,
  prefilter,
  type ToolPair,
  type Turn,
} from "./timeline/grouping";
import { SubagentModal } from "./timeline/SubagentModal";
import { TurnBlock } from "./timeline/TurnBlock";
import "./TimelinePane.css";

const POLL_MS = 1500;

interface SubagentSelection {
  toolUseId: string;
  seedUuid?: string;
  title: string;
}

export function TimelinePane({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [claudeSession, setClaudeSession] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const offsetRef = useRef<number>(-1);
  const virtuoso = useRef<VirtuosoHandle | null>(null);
  const [subagent, setSubagent] = useState<SubagentSelection | null>(null);

  const filterHook = useTimelineFilters();
  const { filters } = filterHook;

  useEffect(() => {
    offsetRef.current = -1;
    setEvents([]);
    setClaudeSession(null);
    setLastError(null);
    setSubagent(null);

    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const resp = await getHistory(sessionId, {
          after: offsetRef.current >= 0 ? offsetRef.current : undefined,
        });
        if (cancelled) return;
        setClaudeSession(resp.claude_session_uuid);
        if (resp.events.length > 0) {
          setEvents((prev) => [...prev, ...resp.events]);
          offsetRef.current = resp.events[resp.events.length - 1].byte_offset;
        }
        setLastError(null);
      } catch (err) {
        if (!cancelled) {
          setLastError(err instanceof Error ? err.message : "history fetch failed");
        }
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  // Pipeline: prefilter (bookkeeping/sidechain) → group → facet filter.
  // Turn-level facet filtering lets a turn pass if any inner event
  // matches, so users see full exchanges rather than decontextualized
  // fragments.
  const turns = useMemo<Turn[]>(() => {
    const prefiltered = prefilter(events, {
      showBookkeeping: filters.showBookkeeping,
      showSidechain: filters.showSidechain,
    });
    const grouped = groupIntoTurns(prefiltered);
    const hasActiveFacet =
      filters.speakers.size > 0 ||
      filters.tools.size > 0 ||
      filters.errorsOnly ||
      filters.filePath.length > 0;
    if (!hasActiveFacet) return grouped;
    return grouped.filter((t) =>
      t.events.some((ev) => eventMatchesFilters(ev, filters)),
    );
  }, [events, filters]);

  const handleSubagent = (pair: ToolPair) => {
    if (!pair.id) return;
    const title = subagentTitleFromPair(pair);
    setSubagent({
      toolUseId: pair.id,
      seedUuid:
        typeof (pair.useEvent.payload as { uuid?: string } | null)?.uuid === "string"
          ? (pair.useEvent.payload as { uuid: string }).uuid
          : undefined,
      title,
    });
  };

  return (
    <div className="timeline-pane" data-testid="timeline-pane">
      <div className="timeline-pane__header">
        <span className="timeline-pane__title">Timeline</span>
        {claudeSession && (
          <span
            className="timeline-pane__session"
            title={`claude session ${claudeSession}`}
          >
            claude {claudeSession.slice(0, 8)}
          </span>
        )}
        <span className="timeline-pane__count">
          {turns.length} turn{turns.length === 1 ? "" : "s"} · {events.length} events
        </span>
        {lastError && (
          <span className="timeline-pane__error" title={lastError}>
            error
          </span>
        )}
      </div>
      <FilterChips {...filterHook} />
      {turns.length === 0 ? (
        <div className="timeline-pane__empty">
          {events.length === 0
            ? claudeSession
              ? "Waiting for events…"
              : "No Claude session correlated yet. Start `claude` in the terminal."
            : "No turns match current filters."}
        </div>
      ) : (
        <Virtuoso
          ref={virtuoso}
          data={turns}
          computeItemKey={(_i, t) => `${t.id}`}
          itemContent={(_i, t) => (
            <TurnBlock
              turn={t}
              showThinking={filters.showThinking}
              onOpenSubagent={handleSubagent}
            />
          )}
          followOutput="smooth"
          className="timeline-pane__list"
        />
      )}
      {subagent && (
        <SubagentModal
          toolUseId={subagent.toolUseId}
          seedUuid={subagent.seedUuid}
          title={subagent.title}
          allEvents={events}
          showThinking={filters.showThinking}
          onClose={() => setSubagent(null)}
        />
      )}
    </div>
  );
}

function subagentTitleFromPair(pair: ToolPair): string {
  const input = (pair.input ?? {}) as Record<string, unknown>;
  const desc = typeof input.description === "string" ? input.description : null;
  const agent =
    typeof input.subagent_type === "string" ? input.subagent_type : null;
  if (desc) return `Agent log · ${desc}`;
  if (agent) return `Agent log · ${agent}`;
  return "Agent log";
}
