import { describe, expect, it } from "vitest";

import {
  formatAssistantItems,
  formatAssistantText,
  formatToolPair,
  formatTurn,
} from "./markdown-export";
import {
  assistantItems,
  makePair,
  makeTurn,
} from "./test-helpers";

describe("markdown-export", () => {
  it("returns the backend-projected turn markdown verbatim", () => {
    const turn = makeTurn({ markdown: "**Prompt**\n\n> hello" });
    expect(formatTurn(turn)).toBe("**Prompt**\n\n> hello");
  });

  it("formats assistant text from projected assistant items", () => {
    expect(formatAssistantText(assistantItems("one", "two"))).toBe("one\n\ntwo");
  });

  it("formats assistant items with inline tool calls", () => {
    const pair = makePair({
      id: "t1",
      name: "bash",
      input: { command: "pwd" },
      result: { content: "/tmp", is_error: false },
    });
    const pairById = new Map([[pair.id, pair]]);
    const out = formatAssistantItems(
      assistantItems("before", { tool: "t1" }, "after"),
      pairById,
    );
    expect(out).toContain("before");
    expect(out).toContain("**Tool:** `bash`");
    expect(out).toContain("after");
  });

  it("formats tool results with error status", () => {
    const out = formatToolPair(
      makePair({
        name: "edit",
        category: "create_content",
        input: { path: "/tmp/a.txt", old_text: "a", new_text: "b" },
        result: { content: "permission denied", is_error: true },
        is_error: true,
      }),
    );
    expect(out).toContain("_(error)_");
    expect(out).toContain("permission denied");
  });
});
