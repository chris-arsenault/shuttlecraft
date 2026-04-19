// Facet chip row rendered above the timeline virtuoso list. Drives the
// useTimelineFilters state; all selections persist to localStorage.

import { KNOWN_TOOLS, type TimelineFilters } from "./filters";
import "./FilterChips.css";

interface Props {
  filters: TimelineFilters;
  toggleSpeaker: (s: "user" | "assistant" | "tool_result") => void;
  toggleTool: (name: string) => void;
  setErrorsOnly: (v: boolean) => void;
  setShowThinking: (v: boolean) => void;
  setShowBookkeeping: (v: boolean) => void;
  setShowSidechain: (v: boolean) => void;
  setFilePath: (v: string) => void;
  reset: () => void;
}

export function FilterChips({
  filters,
  toggleSpeaker,
  toggleTool,
  setErrorsOnly,
  setShowThinking,
  setShowBookkeeping,
  setShowSidechain,
  setFilePath,
  reset,
}: Props) {
  const hasActive =
    filters.speakers.size > 0 ||
    filters.tools.size > 0 ||
    filters.errorsOnly ||
    filters.filePath.length > 0 ||
    !filters.showThinking ||
    filters.showBookkeeping ||
    filters.showSidechain;

  return (
    <div className="fc" data-testid="filter-chips">
      <div className="fc__group">
        <span className="fc__label">Speaker</span>
        <Chip
          active={filters.speakers.has("user")}
          onClick={() => toggleSpeaker("user")}
        >
          user
        </Chip>
        <Chip
          active={filters.speakers.has("assistant")}
          onClick={() => toggleSpeaker("assistant")}
        >
          claude
        </Chip>
        <Chip
          active={filters.speakers.has("tool_result")}
          onClick={() => toggleSpeaker("tool_result")}
        >
          tool result
        </Chip>
      </div>

      <div className="fc__group">
        <span className="fc__label">Tool</span>
        {KNOWN_TOOLS.map((t) => (
          <Chip
            key={t}
            active={filters.tools.has(t)}
            onClick={() => toggleTool(t)}
          >
            {t}
          </Chip>
        ))}
      </div>

      <div className="fc__group">
        <Chip
          active={filters.errorsOnly}
          variant="warn"
          onClick={() => setErrorsOnly(!filters.errorsOnly)}
        >
          errors only
        </Chip>
        <Chip
          active={filters.showThinking}
          variant="neutral"
          onClick={() => setShowThinking(!filters.showThinking)}
        >
          {filters.showThinking ? "💭 thinking" : "💭 thinking (off)"}
        </Chip>
        <Chip
          active={filters.showBookkeeping}
          variant="neutral"
          onClick={() => setShowBookkeeping(!filters.showBookkeeping)}
        >
          {filters.showBookkeeping ? "bookkeeping shown" : "bookkeeping hidden"}
        </Chip>
        <Chip
          active={filters.showSidechain}
          variant="neutral"
          onClick={() => setShowSidechain(!filters.showSidechain)}
        >
          {filters.showSidechain ? "sidechain shown" : "sidechain hidden"}
        </Chip>
      </div>

      <div className="fc__group fc__group--grow">
        <span className="fc__label">File</span>
        <input
          type="text"
          className="fc__input"
          placeholder="path substring…"
          value={filters.filePath}
          onChange={(e) => setFilePath(e.target.value)}
          aria-label="Filter by file path"
        />
      </div>

      {hasActive && (
        <button
          type="button"
          className="fc__clear"
          onClick={reset}
          title="Clear all filters"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  variant?: "default" | "warn" | "neutral";
}) {
  return (
    <button
      type="button"
      className={`fc__chip fc__chip--${variant} ${active ? "fc__chip--active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
