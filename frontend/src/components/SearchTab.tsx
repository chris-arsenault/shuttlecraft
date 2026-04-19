// Universal search. Three scopes: timeline (active session), repo
// (active repo), workspace (everything). Streams NDJSON hits as they
// arrive — file-content matches from ripgrep, event matches from
// Postgres ILIKE. Clicking a hit opens an appropriate tab.
//
// No web worker: the NDJSON parser is ~20 lines and batches render at
// React cadence naturally.

import { useEffect, useMemo, useRef, useState } from "react";

import { searchStream } from "../api/client";
import type { SearchHit, SearchScope } from "../api/types";
import { useSessions } from "../state/SessionStore";
import { useTabs } from "../state/TabStore";
import "./SearchTab.css";

interface Props {
  initialQuery?: string;
  initialScope?: SearchScope;
}

export function SearchTab({ initialQuery = "", initialScope = "workspace" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<SearchScope>(initialScope);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const { sessions, selectedSessionId } = useSessions();
  const { openTab } = useTabs();
  const activeSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const activeRepo = activeSession?.repo ?? null;

  useEffect(() => {
    // Clean up any in-flight request on unmount.
    return () => abortRef.current?.abort();
  }, []);

  const run = (q: string, s: SearchScope) => {
    abortRef.current?.abort();
    if (!q.trim()) {
      setHits([]);
      setRunning(false);
      setDone(true);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setHits([]);
    setRunning(true);
    setDone(false);
    searchStream(
      {
        q,
        scope: s,
        repo: s === "repo" ? activeRepo ?? undefined : undefined,
        session: s === "timeline" ? selectedSessionId ?? undefined : undefined,
        signal: ac.signal,
      },
      (hit) => {
        if (hit.type === "done") {
          setRunning(false);
          setDone(true);
        } else if (hit.type === "error") {
          setRunning(false);
          setDone(true);
        } else {
          setHits((prev) => [...prev, hit]);
        }
      },
    ).catch(() => {
      setRunning(false);
      setDone(true);
    });
  };

  const canUseTimelineScope = selectedSessionId != null;
  const canUseRepoScope = activeRepo != null;

  const disabledNote = useMemo(() => {
    if (scope === "timeline" && !canUseTimelineScope) {
      return "Select a session to search its timeline.";
    }
    if (scope === "repo" && !canUseRepoScope) {
      return "Select a session/repo to search its files.";
    }
    return null;
  }, [scope, canUseTimelineScope, canUseRepoScope]);

  const onHitClick = (hit: SearchHit) => {
    if (hit.type === "file") {
      openTab({ kind: "file", repo: hit.repo, path: hit.path });
    } else if (hit.type === "event" && hit.session_id) {
      openTab({ kind: "timeline", sessionId: hit.session_id });
    }
  };

  return (
    <div className="st">
      <form
        className="st__form"
        onSubmit={(e) => {
          e.preventDefault();
          run(query, scope);
        }}
      >
        <input
          type="text"
          className="st__input"
          placeholder="search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="st__scope-group" role="tablist" aria-label="Search scope">
          {(["timeline", "repo", "workspace"] as SearchScope[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={
                scope === s ? "st__scope st__scope--active" : "st__scope"
              }
              onClick={() => setScope(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button type="submit" className="st__run">
          {running ? "…" : "go"}
        </button>
      </form>
      {disabledNote && <div className="st__note">{disabledNote}</div>}
      <div className="st__results">
        {hits.length === 0 && done && !disabledNote && (
          <div className="st__muted">no matches</div>
        )}
        {hits.map((h, i) => (
          <HitRow key={i} hit={h} onClick={() => onHitClick(h)} />
        ))}
        {running && <div className="st__muted">streaming…</div>}
      </div>
    </div>
  );
}

function HitRow({ hit, onClick }: { hit: SearchHit; onClick: () => void }) {
  if (hit.type === "file") {
    return (
      <button type="button" className="st__hit st__hit--file" onClick={onClick}>
        <span className="st__hit-kind">file</span>
        <span className="st__hit-where">
          {hit.repo} · {hit.path}:{hit.line}
        </span>
        <span className="st__hit-preview">{hit.preview}</span>
      </button>
    );
  }
  if (hit.type === "event") {
    return (
      <button type="button" className="st__hit st__hit--event" onClick={onClick}>
        <span className="st__hit-kind">event</span>
        <span className="st__hit-where">
          {hit.kind} · {new Date(hit.timestamp).toLocaleTimeString()}
        </span>
        <span className="st__hit-preview">{hit.preview}</span>
      </button>
    );
  }
  return null;
}
