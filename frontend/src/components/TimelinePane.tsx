// Polls /api/sessions/:id/history and renders the result as a virtualized
// list of EventBlocks. Dynamic heights (from tool-call expansion) mean
// we need measurement-capable virtualization — react-virtuoso handles
// this out of the box.
//
// Polling strategy:
//   - 1500ms interval while mounted
//   - Only fetch events after the highest byte_offset we've already
//     stored; server returns them in order
//   - Session switch via `sessionId` prop tears down and resets state
//
// The "followOutput" behavior auto-scrolls to the bottom on new events
// unless the user has scrolled up — handled by Virtuoso's built-in
// `followOutput` prop.

import { useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { getHistory } from "../api/client";
import type { TimelineEvent } from "../api/types";
import { EventBlock } from "./timeline/EventBlock";
import "./TimelinePane.css";

const POLL_MS = 1500;

export function TimelinePane({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [claudeSession, setClaudeSession] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const offsetRef = useRef<number>(-1);
  const virtuoso = useRef<VirtuosoHandle | null>(null);

  useEffect(() => {
    // Reset on session change.
    offsetRef.current = -1;
    setEvents([]);
    setClaudeSession(null);
    setLastError(null);

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
        <span className="timeline-pane__count">{events.length} events</span>
        {lastError && (
          <span className="timeline-pane__error" title={lastError}>
            error
          </span>
        )}
      </div>
      {events.length === 0 ? (
        <div className="timeline-pane__empty">
          {claudeSession
            ? "Waiting for events…"
            : "No Claude session correlated yet. Start `claude` in the terminal."}
        </div>
      ) : (
        <Virtuoso
          ref={virtuoso}
          data={events}
          computeItemKey={(_i, e) => `${e.byte_offset}`}
          itemContent={(_i, e) => <EventBlock event={e} />}
          followOutput="smooth"
          className="timeline-pane__list"
        />
      )}
    </div>
  );
}
