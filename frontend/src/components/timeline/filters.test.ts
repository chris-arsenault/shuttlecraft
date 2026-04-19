import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { TimelineEvent } from "../../api/types";
import {
  DEFAULT_FILTERS,
  eventMatchesFilters,
  useTimelineFilters,
  type TimelineFilters,
} from "./filters";

function ev(kind: string, payload: Record<string, unknown>): TimelineEvent {
  return { byte_offset: 1, timestamp: "2025-01-01T00:00:00Z", kind, payload };
}

function base(overrides: Partial<TimelineFilters> = {}): TimelineFilters {
  return {
    speakers: new Set(),
    tools: new Set(),
    errorsOnly: false,
    showThinking: true,
    showBookkeeping: false,
    showSidechain: false,
    filePath: "",
    ...overrides,
  };
}

describe("eventMatchesFilters", () => {
  it("passes all events when no facet is active", () => {
    const e = ev("assistant", {
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    expect(eventMatchesFilters(e, base())).toBe(true);
  });

  it("speaker facet filters by speaker", () => {
    const user = ev("user", {
      type: "user",
      message: { content: [{ type: "text", text: "prompt" }] },
    });
    const assistant = ev("assistant", {
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const f = base({ speakers: new Set(["user"]) });
    expect(eventMatchesFilters(user, f)).toBe(true);
    expect(eventMatchesFilters(assistant, f)).toBe(false);
  });

  it("tool_result speaker is distinct from user", () => {
    const toolResult = ev("user", {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    });
    const f = base({ speakers: new Set(["tool_result"]) });
    expect(eventMatchesFilters(toolResult, f)).toBe(true);
    const realUser = ev("user", {
      type: "user",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    expect(eventMatchesFilters(realUser, f)).toBe(false);
  });

  it("tool facet filters by tool_use name", () => {
    const editTurn = ev("assistant", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "a", name: "Edit", input: {} }],
      },
    });
    const bashTurn = ev("assistant", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "b", name: "Bash", input: {} }],
      },
    });
    const f = base({ tools: new Set(["Edit"]) });
    expect(eventMatchesFilters(editTurn, f)).toBe(true);
    expect(eventMatchesFilters(bashTurn, f)).toBe(false);
  });

  it("errorsOnly filters to events with is_error=true in tool_result", () => {
    const ok = ev("user", {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    });
    const bad = ev("user", {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t2", content: "err", is_error: true },
        ],
      },
    });
    const f = base({ errorsOnly: true });
    expect(eventMatchesFilters(ok, f)).toBe(false);
    expect(eventMatchesFilters(bad, f)).toBe(true);
  });

  it("filePath matches file_path in tool_use inputs", () => {
    const readSrc = ev("assistant", {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "r1",
            name: "Read",
            input: { file_path: "/home/dev/src/foo.ts" },
          },
        ],
      },
    });
    const readOther = ev("assistant", {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "r2",
            name: "Read",
            input: { file_path: "/home/dev/src/bar.ts" },
          },
        ],
      },
    });
    const f = base({ filePath: "foo.ts" });
    expect(eventMatchesFilters(readSrc, f)).toBe(true);
    expect(eventMatchesFilters(readOther, f)).toBe(false);
  });

  it("filePath matches against bash commands too (via JSON fallback)", () => {
    const e = ev("assistant", {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "b1",
            name: "Bash",
            input: { command: "cat /etc/something-unique.conf" },
          },
        ],
      },
    });
    expect(eventMatchesFilters(e, base({ filePath: "something-unique.conf" }))).toBe(true);
  });
});

describe("useTimelineFilters", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults on first render and persists via localStorage", () => {
    const { result } = renderHook(() => useTimelineFilters());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);

    act(() => result.current.toggleSpeaker("user"));
    expect(result.current.filters.speakers.has("user")).toBe(true);

    // New hook instance should pick up the persisted state
    const { result: r2 } = renderHook(() => useTimelineFilters());
    expect(r2.current.filters.speakers.has("user")).toBe(true);
  });

  it("toggleTool adds/removes the tool name", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.toggleTool("Edit"));
    expect(result.current.filters.tools.has("Edit")).toBe(true);
    act(() => result.current.toggleTool("Edit"));
    expect(result.current.filters.tools.has("Edit")).toBe(false);
  });

  it("reset returns to defaults", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => {
      result.current.setShowBookkeeping(true);
      result.current.setFilePath("foo");
      result.current.toggleSpeaker("assistant");
    });
    expect(result.current.filters.showBookkeeping).toBe(true);
    act(() => result.current.reset());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
  });
});
