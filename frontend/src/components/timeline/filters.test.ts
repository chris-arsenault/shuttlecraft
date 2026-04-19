import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { TimelineEvent } from "../../api/types";
import { groupIntoTurns, prefilter, type Turn } from "./grouping";
import {
  DEFAULT_FILTERS,
  hasActiveFacets,
  turnMatchesFilters,
  useTimelineFilters,
  type TimelineFilters,
} from "./filters";

let offset = 0;
function mk(kind: string, payload: Record<string, unknown>): TimelineEvent {
  offset += 100;
  return { byte_offset: offset, timestamp: "2025-01-01T00:00:00Z", kind, payload };
}
function mkUserPrompt(text: string): TimelineEvent {
  return mk("user", {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}
function mkAssistantText(text: string): TimelineEvent {
  return mk("assistant", {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}
function mkAssistantTool(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): TimelineEvent {
  return mk("assistant", {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}
function mkToolResult(
  tool_use_id: string,
  content: string,
  is_error = false,
): TimelineEvent {
  return mk("user", {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id, content, is_error }],
    },
  });
}

function buildTurn(events: TimelineEvent[]): Turn {
  const turns = groupIntoTurns(
    prefilter(events, { showBookkeeping: false, showSidechain: false }),
  );
  expect(turns.length).toBeGreaterThan(0);
  return turns[0]!;
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

describe("turnMatchesFilters — facets AND across, OR within", () => {
  // Canonical turn with user prompt + assistant Edit + tool_result + assistant text.
  function canonicalTurn(): Turn {
    offset = 0;
    return buildTurn([
      mkUserPrompt("edit foo.ts"),
      mkAssistantTool("t1", "Edit", { file_path: "/src/foo.ts" }),
      mkToolResult("t1", "edit applied"),
      mkAssistantText("done"),
    ]);
  }

  it("passes every turn when no facet is active", () => {
    expect(turnMatchesFilters(canonicalTurn(), base())).toBe(true);
  });

  it("speaker=user alone: turn with any user event passes", () => {
    expect(
      turnMatchesFilters(canonicalTurn(), base({ speakers: new Set(["user"]) })),
    ).toBe(true);
  });

  it("speaker=assistant alone: turn with any assistant event passes", () => {
    expect(
      turnMatchesFilters(
        canonicalTurn(),
        base({ speakers: new Set(["assistant"]) }),
      ),
    ).toBe(true);
  });

  it("speaker=tool_result alone: turn with a tool_result wrapper passes", () => {
    expect(
      turnMatchesFilters(
        canonicalTurn(),
        base({ speakers: new Set(["tool_result"]) }),
      ),
    ).toBe(true);
  });

  it("speaker=user + tool=Edit (regression for the cross-facet bug): passes because turn has BOTH independently", () => {
    // Under the old per-event logic, no single event was both a user
    // event and a tool_use Edit, so the turn was wrongly excluded.
    expect(
      turnMatchesFilters(
        canonicalTurn(),
        base({ speakers: new Set(["user"]), tools: new Set(["Edit"]) }),
      ),
    ).toBe(true);
  });

  it("speaker=assistant + tool=Bash: FAILS when no Bash in turn", () => {
    expect(
      turnMatchesFilters(
        canonicalTurn(),
        base({ speakers: new Set(["assistant"]), tools: new Set(["Bash"]) }),
      ),
    ).toBe(false);
  });

  it("tools facet is OR within: selecting Edit OR Bash passes a turn with only Edit", () => {
    expect(
      turnMatchesFilters(
        canonicalTurn(),
        base({ tools: new Set(["Edit", "Bash"]) }),
      ),
    ).toBe(true);
  });

  it("'select a few, then turn one off' drops the turn only when no selection still matches", () => {
    const t = canonicalTurn();
    expect(
      turnMatchesFilters(t, base({ tools: new Set(["Edit", "Bash"]) })),
    ).toBe(true);
    // Drop Edit — only Bash remains, turn doesn't have Bash → fails.
    expect(turnMatchesFilters(t, base({ tools: new Set(["Bash"]) }))).toBe(false);
    // Drop the WRONG one — Bash was never in turn; unselecting leaves
    // Edit active and the turn still passes.
    expect(turnMatchesFilters(t, base({ tools: new Set(["Edit"]) }))).toBe(true);
  });

  it("errorsOnly passes turns whose any tool_result has is_error=true", () => {
    offset = 0;
    const errorTurn = buildTurn([
      mkUserPrompt("do bad thing"),
      mkAssistantTool("e1", "Bash", { command: "fail" }),
      mkToolResult("e1", "command not found", true),
    ]);
    const noErrorTurn = buildTurn([
      mkUserPrompt("do good thing"),
      mkAssistantTool("ok1", "Read", { file_path: "/a" }),
      mkToolResult("ok1", "content"),
    ]);
    expect(turnMatchesFilters(errorTurn, base({ errorsOnly: true }))).toBe(true);
    expect(turnMatchesFilters(noErrorTurn, base({ errorsOnly: true }))).toBe(false);
  });

  it("filePath matches file_path in any tool_use input (case-insensitive substring)", () => {
    offset = 0;
    const t = buildTurn([
      mkUserPrompt("touch it"),
      mkAssistantTool("e", "Edit", { file_path: "/src/FOO.ts" }),
      mkToolResult("e", "ok"),
    ]);
    expect(turnMatchesFilters(t, base({ filePath: "foo" }))).toBe(true);
    expect(turnMatchesFilters(t, base({ filePath: "bar" }))).toBe(false);
  });

  it("filePath + speaker compose correctly", () => {
    offset = 0;
    const t = buildTurn([
      mkUserPrompt("read foo"),
      mkAssistantTool("r", "Read", { file_path: "/src/foo.ts" }),
      mkToolResult("r", "contents"),
    ]);
    expect(
      turnMatchesFilters(
        t,
        base({ speakers: new Set(["user"]), filePath: "foo" }),
      ),
    ).toBe(true);
  });

  it("empty set on speakers means 'no constraint', not 'match nothing'", () => {
    const t = canonicalTurn();
    // Tool facet satisfied; speakers facet inactive → passes.
    expect(turnMatchesFilters(t, base({ tools: new Set(["Edit"]) }))).toBe(true);
  });

  it("complex: [user, assistant] speakers + [Edit, Bash] tools matches turn with user+Edit", () => {
    expect(
      turnMatchesFilters(
        canonicalTurn(),
        base({
          speakers: new Set(["user", "assistant"]),
          tools: new Set(["Edit", "Bash"]),
        }),
      ),
    ).toBe(true);
  });

  it("turn with NO assistant events: speaker=assistant drops it", () => {
    offset = 0;
    const t = buildTurn([mkUserPrompt("just a prompt, no reply yet")]);
    expect(
      turnMatchesFilters(t, base({ speakers: new Set(["assistant"]) })),
    ).toBe(false);
  });
});

describe("hasActiveFacets", () => {
  it("returns false for the default filters", () => {
    expect(hasActiveFacets(base())).toBe(false);
  });

  it("returns true as soon as any facet is non-empty", () => {
    expect(hasActiveFacets(base({ speakers: new Set(["user"]) }))).toBe(true);
    expect(hasActiveFacets(base({ tools: new Set(["Edit"]) }))).toBe(true);
    expect(hasActiveFacets(base({ errorsOnly: true }))).toBe(true);
    expect(hasActiveFacets(base({ filePath: "x" }))).toBe(true);
  });

  it("ignores display toggles (thinking / bookkeeping / sidechain)", () => {
    expect(hasActiveFacets(base({ showThinking: false }))).toBe(false);
    expect(hasActiveFacets(base({ showBookkeeping: true }))).toBe(false);
    expect(hasActiveFacets(base({ showSidechain: true }))).toBe(false);
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

  it("defaults are strict booleans — none of the toggles are undefined", () => {
    const { result } = renderHook(() => useTimelineFilters());
    const f = result.current.filters;
    expect(typeof f.errorsOnly).toBe("boolean");
    expect(typeof f.showThinking).toBe("boolean");
    expect(typeof f.showBookkeeping).toBe("boolean");
    expect(typeof f.showSidechain).toBe("boolean");
    expect(typeof f.filePath).toBe("string");
    expect(f.speakers).toBeInstanceOf(Set);
    expect(f.tools).toBeInstanceOf(Set);
  });

  it("localStorage rehydration coerces wrong types back to strict booleans", () => {
    window.localStorage.setItem(
      "shuttlecraft.timeline.filters.v1",
      JSON.stringify({
        speakers: ["user"],
        tools: ["Edit"],
        errorsOnly: "nope",
        showThinking: null,
        showBookkeeping: undefined,
        showSidechain: 1,
        filePath: 42,
      }),
    );
    const { result } = renderHook(() => useTimelineFilters());
    const f = result.current.filters;
    expect(typeof f.errorsOnly).toBe("boolean");
    expect(typeof f.showThinking).toBe("boolean");
    expect(typeof f.showBookkeeping).toBe("boolean");
    expect(typeof f.showSidechain).toBe("boolean");
    expect(typeof f.filePath).toBe("string");
    // Valid set-member entries survive.
    expect(f.speakers.has("user")).toBe(true);
    expect(f.tools.has("Edit")).toBe(true);
  });
});
