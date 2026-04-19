import { useEffect, useState } from "react";

import type { TimelineEvent } from "../../api/types";
import {
  hasToolError,
  isToolResultUser,
  payloadOf,
  toolUsesIn,
} from "./types";

export type SpeakerFacet = "user" | "assistant" | "tool_result";

export interface TimelineFilters {
  /** Empty set means "no speaker filter" — all pass. Non-empty means only
   * these speakers pass. */
  speakers: Set<SpeakerFacet>;
  /** Tool-name filter. Empty = no constraint. Non-empty = only events
   * that contain a tool_use with a matching name. Applies to turn-level
   * filtering downstream (a turn passes if any inner event matches). */
  tools: Set<string>;
  /** When true, only events with an error pass (tool_result.is_error
   * or a known error kind). */
  errorsOnly: boolean;
  /** When false, thinking content is hidden in the render layer. Does
   * NOT drop thinking-carrying events — they may have useful text too. */
  showThinking: boolean;
  /** When false, bookkeeping-kind events (file-history-snapshot,
   * permission-mode, last-prompt, queue-operation, attachment, isMeta
   * system) are dropped before grouping. */
  showBookkeeping: boolean;
  /** When false, isSidechain=true events are dropped before grouping
   * and accessible only via the subagent modal. */
  showSidechain: boolean;
  /** Substring match against file paths in Edit/Write/Read inputs and
   * Bash commands. Empty string = no constraint. */
  filePath: string;
}

export const DEFAULT_FILTERS: TimelineFilters = {
  speakers: new Set(),
  tools: new Set(),
  errorsOnly: false,
  showThinking: true,
  showBookkeeping: false,
  showSidechain: false,
  filePath: "",
};

const STORAGE_KEY = "shuttlecraft.timeline.filters.v1";

// ─── persistence ──────────────────────────────────────────────────────

interface SerializedFilters {
  speakers: SpeakerFacet[];
  tools: string[];
  errorsOnly: boolean;
  showThinking: boolean;
  showBookkeeping: boolean;
  showSidechain: boolean;
  filePath: string;
}

function serialize(f: TimelineFilters): SerializedFilters {
  return {
    speakers: Array.from(f.speakers),
    tools: Array.from(f.tools),
    errorsOnly: f.errorsOnly,
    showThinking: f.showThinking,
    showBookkeeping: f.showBookkeeping,
    showSidechain: f.showSidechain,
    filePath: f.filePath,
  };
}

function deserialize(raw: unknown): TimelineFilters {
  const base: TimelineFilters = {
    speakers: new Set(DEFAULT_FILTERS.speakers),
    tools: new Set(DEFAULT_FILTERS.tools),
    errorsOnly: DEFAULT_FILTERS.errorsOnly,
    showThinking: DEFAULT_FILTERS.showThinking,
    showBookkeeping: DEFAULT_FILTERS.showBookkeeping,
    showSidechain: DEFAULT_FILTERS.showSidechain,
    filePath: DEFAULT_FILTERS.filePath,
  };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<SerializedFilters>;
  return {
    speakers: new Set(
      Array.isArray(r.speakers)
        ? r.speakers.filter(
            (s): s is SpeakerFacet =>
              s === "user" || s === "assistant" || s === "tool_result",
          )
        : [],
    ),
    tools: new Set(
      Array.isArray(r.tools) ? r.tools.filter((t) => typeof t === "string") : [],
    ),
    errorsOnly: typeof r.errorsOnly === "boolean" ? r.errorsOnly : base.errorsOnly,
    showThinking:
      typeof r.showThinking === "boolean" ? r.showThinking : base.showThinking,
    showBookkeeping:
      typeof r.showBookkeeping === "boolean"
        ? r.showBookkeeping
        : base.showBookkeeping,
    showSidechain:
      typeof r.showSidechain === "boolean" ? r.showSidechain : base.showSidechain,
    filePath: typeof r.filePath === "string" ? r.filePath : base.filePath,
  };
}

export function useTimelineFilters(): {
  filters: TimelineFilters;
  setFilters: (
    updater: TimelineFilters | ((prev: TimelineFilters) => TimelineFilters),
  ) => void;
  toggleSpeaker: (s: SpeakerFacet) => void;
  toggleTool: (t: string) => void;
  setErrorsOnly: (v: boolean) => void;
  setShowThinking: (v: boolean) => void;
  setShowBookkeeping: (v: boolean) => void;
  setShowSidechain: (v: boolean) => void;
  setFilePath: (v: string) => void;
  reset: () => void;
} {
  const [filters, setFiltersState] = useState<TimelineFilters>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_FILTERS };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return deserialize(JSON.parse(raw));
    } catch {
      // fall through to default
    }
    return { ...DEFAULT_FILTERS };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(filters)));
    } catch {
      // storage may be full or disabled; ignore
    }
  }, [filters]);

  const setFilters = (
    updater: TimelineFilters | ((prev: TimelineFilters) => TimelineFilters),
  ) => {
    setFiltersState((prev) =>
      typeof updater === "function" ? updater(prev) : updater,
    );
  };

  const toggleSpeaker = (s: SpeakerFacet) =>
    setFilters((prev) => {
      const next = new Set(prev.speakers);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...prev, speakers: next };
    });

  const toggleTool = (t: string) =>
    setFilters((prev) => {
      const next = new Set(prev.tools);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return { ...prev, tools: next };
    });

  return {
    filters,
    setFilters,
    toggleSpeaker,
    toggleTool,
    setErrorsOnly: (v) => setFilters((p) => ({ ...p, errorsOnly: v })),
    setShowThinking: (v) => setFilters((p) => ({ ...p, showThinking: v })),
    setShowBookkeeping: (v) => setFilters((p) => ({ ...p, showBookkeeping: v })),
    setShowSidechain: (v) => setFilters((p) => ({ ...p, showSidechain: v })),
    setFilePath: (v) => setFilters((p) => ({ ...p, filePath: v })),
    reset: () => setFilters({ ...DEFAULT_FILTERS }),
  };
}

// ─── event-level matching ─────────────────────────────────────────────

function speakerOf(ev: TimelineEvent): SpeakerFacet | null {
  if (ev.kind === "assistant") return "assistant";
  if (ev.kind === "user") return isToolResultUser(ev) ? "tool_result" : "user";
  return null;
}

function filePathMatches(ev: TimelineEvent, needle: string): boolean {
  if (!needle) return true;
  const lower = needle.toLowerCase();
  // Check assistant tool_use inputs
  for (const use of toolUsesIn(ev)) {
    const input = use.input as Record<string, unknown> | undefined;
    if (!input) continue;
    for (const key of ["file_path", "path", "pattern", "command"]) {
      const v = input[key];
      if (typeof v === "string" && v.toLowerCase().includes(lower)) return true;
    }
    // MultiEdit: edits[].file_path isn't present, but MultiEdit's input has
    // file_path at top level. Covered above.
  }
  // Check stringified payload as a fallback (cheaper than recursing)
  const pjson = JSON.stringify(payloadOf(ev)).toLowerCase();
  return pjson.includes(lower);
}

/** Predicate: does this single event pass the current filter set? Used
 * to decide whether a turn (which contains at least one matching event)
 * is visible. */
export function eventMatchesFilters(
  ev: TimelineEvent,
  f: TimelineFilters,
): boolean {
  // Speaker
  if (f.speakers.size > 0) {
    const sp = speakerOf(ev);
    if (!sp || !f.speakers.has(sp)) return false;
  }
  // Tool name
  if (f.tools.size > 0) {
    const uses = toolUsesIn(ev);
    if (!uses.some((u) => u.name && f.tools.has(u.name))) return false;
  }
  // Errors only
  if (f.errorsOnly) {
    if (!hasToolError(ev)) return false;
  }
  // File path
  if (f.filePath && !filePathMatches(ev, f.filePath)) return false;
  return true;
}

export const KNOWN_TOOLS = [
  "Edit",
  "Write",
  "MultiEdit",
  "Bash",
  "Read",
  "Grep",
  "Glob",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
] as const;
