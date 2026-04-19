import { describe, expect, it } from "vitest";

import type { TimelineEvent } from "../../api/types";
import {
  formatAssistantEvent,
  formatAssistantText,
  formatToolPair,
  formatTurn,
} from "./markdown-export";
import type { ToolPair, Turn } from "./grouping";

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
function mkAssistant(blocks: unknown[]): TimelineEvent {
  return mk("assistant", {
    type: "assistant",
    message: { role: "assistant", content: blocks },
  });
}

function turnFrom(prompt: TimelineEvent, events: TimelineEvent[], pairs: ToolPair[]): Turn {
  return {
    id: prompt.byte_offset,
    userPrompt: prompt,
    events: [prompt, ...events],
    startTimestamp: prompt.timestamp,
    endTimestamp: events[events.length - 1]?.timestamp ?? prompt.timestamp,
    durationMs: 0,
    toolPairs: pairs,
    thinkingCount: 0,
    hasErrors: pairs.some((p) => p.isError),
  };
}

describe("markdown-export", () => {
  describe("formatAssistantText", () => {
    it("returns plain text content joined by blank lines", () => {
      const e = mkAssistant([
        { type: "text", text: "First paragraph." },
        { type: "text", text: "Second paragraph." },
      ]);
      expect(formatAssistantText(e)).toBe("First paragraph.\n\nSecond paragraph.");
    });

    it("ignores tool_use and thinking blocks", () => {
      const e = mkAssistant([
        { type: "text", text: "reply text" },
        { type: "tool_use", id: "t", name: "Read", input: {} },
        { type: "thinking", thinking: "noise" },
      ]);
      expect(formatAssistantText(e)).toBe("reply text");
    });
  });

  describe("formatToolPair", () => {
    const mkPair = (overrides: Partial<ToolPair>): ToolPair => ({
      id: "t",
      name: "Read",
      input: {},
      use: { type: "tool_use", id: "t", name: "Read" } as never,
      useEvent: mkAssistant([]),
      result: null,
      resultEvent: null,
      isError: false,
      isPending: false,
      ...overrides,
    });

    it("Bash renders as ```bash fence", () => {
      const out = formatToolPair(
        mkPair({ name: "Bash", input: { command: "ls -la" } }),
      );
      expect(out).toContain("```bash");
      expect(out).toContain("ls -la");
      expect(out).toContain("**Tool:** `Bash`");
    });

    it("Edit renders as ```diff fence with -/+ lines", () => {
      const out = formatToolPair(
        mkPair({
          name: "Edit",
          input: {
            file_path: "/src/foo.ts",
            old_string: "hello",
            new_string: "hello world",
          },
        }),
      );
      expect(out).toContain("/src/foo.ts");
      expect(out).toContain("```diff");
      expect(out).toContain("- hello");
      expect(out).toContain("+ hello world");
    });

    it("TodoWrite renders as a markdown task list", () => {
      const out = formatToolPair(
        mkPair({
          name: "TodoWrite",
          input: {
            todos: [
              { status: "completed", content: "done thing" },
              { status: "in_progress", content: "doing thing" },
              { status: "pending", content: "future thing" },
            ],
          },
        }),
      );
      expect(out).toContain("- [x] done thing");
      expect(out).toContain("- [~] doing thing");
      expect(out).toContain("- [ ] future thing");
    });

    it("Error pair adds '(error)' marker to header", () => {
      const out = formatToolPair(
        mkPair({
          name: "Bash",
          input: { command: "oops" },
          result: {
            type: "tool_result",
            tool_use_id: "t",
            content: "command not found",
            is_error: true,
          },
          isError: true,
        }),
      );
      expect(out).toContain("_(error)_");
      expect(out).toContain("command not found");
    });

    it("Pending pair marks pending in header and omits result", () => {
      const out = formatToolPair(
        mkPair({ name: "Bash", input: { command: "ls" }, isPending: true }),
      );
      expect(out).toContain("_(pending)_");
      expect(out).not.toContain("Result");
    });

    it("Body containing triple-backticks escapes the fence to four", () => {
      const out = formatToolPair(
        mkPair({
          name: "Bash",
          input: { command: "echo '```'" },
        }),
      );
      expect(out).toContain("````bash");
    });
  });

  describe("formatTurn", () => {
    it("renders prompt + assistant text + tool calls as a single markdown doc", () => {
      offset = 0;
      const prompt = mkUserPrompt("edit foo.ts");
      const asst = mkAssistant([
        { type: "text", text: "I'll do that." },
        { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/foo", old_string: "a", new_string: "b" } },
        { type: "text", text: "Done." },
      ]);
      const pair: ToolPair = {
        id: "t1",
        name: "Edit",
        input: { file_path: "/foo", old_string: "a", new_string: "b" },
        use: { type: "tool_use", id: "t1", name: "Edit" } as never,
        useEvent: asst,
        result: { type: "tool_result", tool_use_id: "t1", content: "done" },
        resultEvent: asst,
        isError: false,
        isPending: false,
      };
      const t = turnFrom(prompt, [asst], [pair]);
      const out = formatTurn(t);
      expect(out).toContain("**Prompt**");
      expect(out).toContain("> edit foo.ts");
      expect(out).toContain("I'll do that.");
      expect(out).toContain("**Tool:** `Edit`");
      expect(out).toContain("- a");
      expect(out).toContain("+ b");
      expect(out).toContain("Done.");
    });

    it("multi-line prompt gets quoted on each line", () => {
      offset = 0;
      const prompt = mkUserPrompt("line one\nline two");
      const t = turnFrom(prompt, [], []);
      const out = formatTurn(t);
      expect(out).toContain("> line one");
      expect(out).toContain("> line two");
    });

    it("orphan turn (no user prompt) still formats assistant content", () => {
      offset = 0;
      const asst = mkAssistant([{ type: "text", text: "boot" }]);
      const t: Turn = {
        id: asst.byte_offset,
        userPrompt: null,
        events: [asst],
        startTimestamp: asst.timestamp,
        endTimestamp: asst.timestamp,
        durationMs: 0,
        toolPairs: [],
        thinkingCount: 0,
        hasErrors: false,
      };
      const out = formatTurn(t);
      expect(out).toContain("boot");
    });
  });

  describe("formatAssistantEvent", () => {
    it("interleaves text and tool calls in block order", () => {
      offset = 0;
      const asst = mkAssistant([
        { type: "text", text: "first" },
        { type: "tool_use", id: "t", name: "Bash", input: { command: "ls" } },
        { type: "text", text: "second" },
      ]);
      const pair: ToolPair = {
        id: "t",
        name: "Bash",
        input: { command: "ls" },
        use: { type: "tool_use", id: "t", name: "Bash" } as never,
        useEvent: asst,
        result: null,
        resultEvent: null,
        isError: false,
        isPending: true,
      };
      const out = formatAssistantEvent(asst, new Map([["t", pair]]));
      const firstIdx = out.indexOf("first");
      const toolIdx = out.indexOf("**Tool:**");
      const secondIdx = out.indexOf("second");
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(toolIdx).toBeGreaterThan(firstIdx);
      expect(secondIdx).toBeGreaterThan(toolIdx);
    });
  });
});
