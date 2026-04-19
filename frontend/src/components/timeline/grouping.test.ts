import { describe, expect, it } from "vitest";

import type { TimelineEvent } from "../../api/types";
import { groupIntoTurns, prefilter } from "./grouping";

let nextOffset = 0;
function mk(
  kind: string,
  payload: Record<string, unknown>,
  timestamp = "2025-01-01T00:00:00Z",
): TimelineEvent {
  nextOffset += 100;
  return { byte_offset: nextOffset, timestamp, kind, payload };
}

function userPrompt(text: string, ts?: string): TimelineEvent {
  return mk(
    "user",
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    },
    ts,
  );
}

function toolResultUser(toolUseId: string, content: string, is_error = false): TimelineEvent {
  return mk("user", {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: toolUseId, content, is_error },
      ],
    },
  });
}

function assistant(blocks: unknown[], ts?: string): TimelineEvent {
  return mk(
    "assistant",
    {
      type: "assistant",
      message: { role: "assistant", content: blocks },
    },
    ts,
  );
}

describe("groupIntoTurns", () => {
  it("starts a new turn on each real user prompt", () => {
    nextOffset = 0;
    const events = [
      userPrompt("hello"),
      assistant([{ type: "text", text: "hi" }]),
      userPrompt("second"),
      assistant([{ type: "text", text: "ok" }]),
    ];
    const turns = groupIntoTurns(events);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.events).toHaveLength(2);
    expect(turns[1]!.events).toHaveLength(2);
  });

  it("folds tool_result user events into the containing turn without starting a new one", () => {
    nextOffset = 0;
    const events = [
      userPrompt("read a file"),
      assistant([
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.txt" } },
      ]),
      toolResultUser("t1", "file contents"),
      assistant([{ type: "text", text: "done" }]),
      userPrompt("next"),
    ];
    const turns = groupIntoTurns(events);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.events).toHaveLength(4); // prompt + assistant + tool_result + assistant
    expect(turns[1]!.events).toHaveLength(1);
  });

  it("pairs tool_use with tool_result by id and carries error/pending state", () => {
    nextOffset = 0;
    const events = [
      userPrompt("prompt"),
      assistant([
        { type: "tool_use", id: "ok1", name: "Read", input: { file_path: "/a" } },
        { type: "tool_use", id: "err1", name: "Bash", input: { command: "bad" } },
        { type: "tool_use", id: "pend1", name: "Grep", input: { pattern: "x" } },
      ]),
      toolResultUser("ok1", "ok content"),
      toolResultUser("err1", "stderr text", true),
      // pend1 intentionally has no result
    ];
    const [turn] = groupIntoTurns(events);
    expect(turn!.toolPairs).toHaveLength(3);
    const byId = new Map(turn!.toolPairs.map((p) => [p.id, p]));
    expect(byId.get("ok1")!.isPending).toBe(false);
    expect(byId.get("ok1")!.isError).toBe(false);
    expect(byId.get("err1")!.isError).toBe(true);
    expect(byId.get("pend1")!.isPending).toBe(true);
    expect(turn!.hasErrors).toBe(true);
  });

  it("counts thinking-block assistant events", () => {
    nextOffset = 0;
    const events = [
      userPrompt("p"),
      assistant([{ type: "thinking", thinking: "reasoning 1" }]),
      assistant([{ type: "text", text: "hi" }]),
      assistant([
        { type: "thinking", thinking: "reasoning 2" },
        { type: "text", text: "done" },
      ]),
    ];
    const [turn] = groupIntoTurns(events);
    expect(turn!.thinkingCount).toBe(2);
  });

  it("creates a synthetic orphan turn for events before any user prompt", () => {
    nextOffset = 0;
    const events = [
      assistant([{ type: "text", text: "boot" }]),
      userPrompt("first real prompt"),
    ];
    const turns = groupIntoTurns(events);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.userPrompt).toBeNull();
    expect(turns[1]!.userPrompt).not.toBeNull();
  });

  it("computes duration from first to last event", () => {
    nextOffset = 0;
    const events = [
      userPrompt("p", "2025-01-01T00:00:00Z"),
      assistant([{ type: "text", text: "t" }], "2025-01-01T00:00:05Z"),
    ];
    const [turn] = groupIntoTurns(events);
    expect(turn!.durationMs).toBe(5000);
  });
});

describe("prefilter", () => {
  it("drops bookkeeping event kinds when showBookkeeping=false", () => {
    nextOffset = 0;
    const events = [
      userPrompt("p"),
      mk("file-history-snapshot", { type: "file-history-snapshot" }),
      mk("permission-mode", { type: "permission-mode" }),
      mk("last-prompt", { type: "last-prompt" }),
      mk("queue-operation", { type: "queue-operation" }),
      mk("attachment", { type: "attachment" }),
    ];
    const out = prefilter(events, { showBookkeeping: false, showSidechain: false });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("user");
  });

  it("keeps bookkeeping event kinds when showBookkeeping=true", () => {
    nextOffset = 0;
    const events = [
      userPrompt("p"),
      mk("file-history-snapshot", { type: "file-history-snapshot" }),
    ];
    const out = prefilter(events, { showBookkeeping: true, showSidechain: false });
    expect(out).toHaveLength(2);
  });

  it("drops sidechain events when showSidechain=false", () => {
    nextOffset = 0;
    const events = [
      userPrompt("p"),
      mk("assistant", {
        type: "assistant",
        isSidechain: true,
        message: { content: [{ type: "text", text: "sub" }] },
      }),
    ];
    const out = prefilter(events, { showBookkeeping: false, showSidechain: false });
    expect(out).toHaveLength(1);
  });

  it("drops isMeta system events when showBookkeeping=false", () => {
    nextOffset = 0;
    const events = [
      userPrompt("p"),
      mk("system", { type: "system", isMeta: true }),
      mk("system", { type: "system", isMeta: false, message: { content: "real system" } }),
    ];
    const out = prefilter(events, { showBookkeeping: false, showSidechain: false });
    expect(out).toHaveLength(2); // user + non-meta system
    expect(out.map((e) => e.kind)).toEqual(["user", "system"]);
  });
});
