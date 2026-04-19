import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TurnDetail } from "./TurnDetail";
import {
  assistantChunk,
  assistantItems,
  makePair,
  makeSubagent,
  makeTurn,
  toolChunk,
} from "./test-helpers";

describe("TurnDetail", () => {
  it("renders prompt, assistant text, and projected tool rows", () => {
    const pair = makePair({
      id: "t1",
      name: "bash",
      input: { command: "pwd" },
      result: { content: "/tmp", is_error: false },
    });
    render(
      <TurnDetail
        turn={makeTurn({
          user_prompt_text: "my prompt",
          tool_pairs: [pair],
          operation_count: 1,
          chunks: [
            assistantChunk(assistantItems("before", { tool: "t1" }, "after")),
            toolChunk("t1"),
          ],
        })}
        showThinking={true}
      />,
    );
    expect(screen.getByText(/my prompt/)).toBeDefined();
    expect(screen.getByText(/before/)).toBeDefined();
    expect(screen.getByText("bash")).toBeDefined();
  });

  it("hides thinking chips when showThinking=false", () => {
    render(
      <TurnDetail
        turn={makeTurn({
          thinking_count: 1,
          chunks: [assistantChunk(assistantItems("reply"), ["private thought"])],
        })}
        showThinking={false}
      />,
    );
    expect(screen.queryByText(/thinking/i)).toBeNull();
  });

  it("shows tool error state and result body", () => {
    const pair = makePair({
      id: "e1",
      name: "edit",
      category: "create_content",
      input: { path: "/tmp/file.txt" },
      result: { content: "permission denied", is_error: true },
      is_error: true,
    });
    render(
      <TurnDetail
        turn={makeTurn({
          tool_pairs: [pair],
          has_errors: true,
          operation_count: 1,
          chunks: [toolChunk("e1")],
        })}
        showThinking={true}
      />,
    );
    expect(screen.getByText(/errors/i)).toBeDefined();
    expect(screen.getByText(/permission denied/i)).toBeDefined();
  });

  it("opens subagent log button only for task pairs with projected subagent data", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const pair = makePair({
      id: "task-1",
      name: "task",
      category: "delegate",
      input: { description: "delegate work" },
      subagent: makeSubagent({ title: "Agent log · delegate work" }),
    });
    render(
      <TurnDetail
        turn={makeTurn({
          tool_pairs: [pair],
          operation_count: 1,
          chunks: [toolChunk("task-1")],
        })}
        showThinking={true}
        onOpenSubagent={onOpen}
      />,
    );
    await user.click(screen.getByText(/view agent log/i));
    expect(onOpen).toHaveBeenCalledWith(pair);
  });
});
