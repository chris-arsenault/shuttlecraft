import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Turn, ToolPair } from "./grouping";
import type { TimelineEvent } from "../../api/types";
import { TurnBlock } from "./TurnBlock";

function assistantEvent(
  blocks: unknown[],
  byte_offset = 200,
): TimelineEvent {
  return {
    byte_offset,
    timestamp: "2025-01-01T00:00:00Z",
    kind: "assistant",
    payload: {
      type: "assistant",
      message: { role: "assistant", content: blocks },
    },
  };
}

function userEvent2(text: string, byte_offset = 100): TimelineEvent {
  return {
    byte_offset,
    timestamp: "2025-01-01T00:00:00Z",
    kind: "user",
    payload: {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    },
  };
}

function turnOf(
  prompt: TimelineEvent,
  events: TimelineEvent[],
  overrides: Partial<Turn> = {},
): Turn {
  return {
    id: prompt.byte_offset,
    userPrompt: prompt,
    events: [prompt, ...events],
    startTimestamp: prompt.timestamp,
    endTimestamp:
      events[events.length - 1]?.timestamp ?? prompt.timestamp,
    durationMs: 1000,
    toolPairs: [],
    thinkingCount: 0,
    hasErrors: false,
    ...overrides,
  };
}

describe("TurnBlock", () => {
  it("shows the user prompt preview in the collapsed header", () => {
    const prompt = userEvent2("please do the thing");
    const turn = turnOf(prompt, [assistantEvent([{ type: "text", text: "ok" }])]);
    render(<TurnBlock turn={turn} showThinking={true} />);
    expect(screen.getByText(/please do the thing/)).toBeDefined();
  });

  it("expands on click and renders the user prompt + assistant text", async () => {
    const prompt = userEvent2("run ls");
    const assistant = assistantEvent([{ type: "text", text: "here you go" }]);
    const turn = turnOf(prompt, [assistant]);
    render(<TurnBlock turn={turn} showThinking={true} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /run ls/ }));
    expect(screen.getByText("here you go")).toBeDefined();
  });

  it("renders thinking sub-blocks with their content when showThinking=true", async () => {
    const prompt = userEvent2("think hard");
    const assistant = assistantEvent([
      { type: "thinking", thinking: "let me consider…" },
      { type: "text", text: "ok got it" },
    ]);
    const turn = turnOf(prompt, [assistant], { thinkingCount: 1 });
    render(<TurnBlock turn={turn} showThinking={true} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /think hard/ }));
    expect(screen.getByText("let me consider…")).toBeDefined();
  });

  it("hides thinking content when showThinking=false", async () => {
    const prompt = userEvent2("keep reasoning hidden");
    const assistant = assistantEvent([
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "visible text" },
    ]);
    const turn = turnOf(prompt, [assistant], { thinkingCount: 1 });
    render(<TurnBlock turn={turn} showThinking={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /keep reasoning hidden/ }));
    expect(screen.queryByText("private reasoning")).toBeNull();
    expect(screen.getByText("visible text")).toBeDefined();
  });

  it("renders tool-use badges in the header", () => {
    const prompt = userEvent2("edit stuff");
    const use = {
      type: "tool_use",
      id: "t1",
      name: "Edit",
      input: { file_path: "/x.ts" },
    };
    const assistant = assistantEvent([use]);
    const pair: ToolPair = {
      id: "t1",
      name: "Edit",
      input: { file_path: "/x.ts" },
      use: use as never,
      useEvent: assistant,
      result: null,
      resultEvent: null,
      isError: false,
      isPending: true,
    };
    const turn = turnOf(prompt, [assistant], { toolPairs: [pair] });
    render(<TurnBlock turn={turn} showThinking={true} />);
    expect(screen.getByText("Edit")).toBeDefined();
  });

  it("renders a successful tool pair collapsed (low-signal), errors expanded", async () => {
    const prompt = userEvent2("do tools");
    const okUse = { type: "tool_use", id: "ok", name: "Read", input: { file_path: "/a" } };
    const errUse = { type: "tool_use", id: "er", name: "Bash", input: { command: "fail" } };
    const assistant = assistantEvent([okUse, errUse]);
    const okPair: ToolPair = {
      id: "ok",
      name: "Read",
      input: { file_path: "/a" },
      use: okUse as never,
      useEvent: assistant,
      result: { type: "tool_result", tool_use_id: "ok", content: "file contents" },
      resultEvent: assistant,
      isError: false,
      isPending: false,
    };
    const errPair: ToolPair = {
      id: "er",
      name: "Bash",
      input: { command: "fail" },
      use: errUse as never,
      useEvent: assistant,
      result: {
        type: "tool_result",
        tool_use_id: "er",
        content: "command not found",
        is_error: true,
      },
      resultEvent: assistant,
      isError: true,
      isPending: false,
    };
    const turn = turnOf(prompt, [assistant], {
      toolPairs: [okPair, errPair],
      hasErrors: true,
    });
    render(<TurnBlock turn={turn} showThinking={true} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /do tools/ }));

    // The error pair is expanded by default → result text shows
    expect(screen.getByText(/command not found/)).toBeDefined();
    // The OK pair is collapsed → result NOT shown in the body yet
    expect(screen.queryByText(/file contents/)).toBeNull();
  });

  it("Task tool shows View agent log button that fires onOpenSubagent", async () => {
    const prompt = userEvent2("spawn agent");
    const use = {
      type: "tool_use",
      id: "t1",
      name: "Task",
      input: { subagent_type: "Explore", prompt: "go look" },
    };
    const assistant = assistantEvent([use]);
    const pair: ToolPair = {
      id: "t1",
      name: "Task",
      input: use.input,
      use: use as never,
      useEvent: assistant,
      result: null,
      resultEvent: null,
      isError: false,
      isPending: true,
    };
    const turn = turnOf(prompt, [assistant], { toolPairs: [pair] });
    const onOpen = vi.fn();
    render(
      <TurnBlock turn={turn} showThinking={true} onOpenSubagent={onOpen} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /spawn agent/ }));
    const btn = screen.getByRole("button", { name: /view agent log/i });
    await user.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0]!.id).toBe("t1");
  });

  it("renders an error indicator in the header when the turn has errors", () => {
    const prompt = userEvent2("uh oh");
    const turn = turnOf(prompt, [], { hasErrors: true });
    render(<TurnBlock turn={turn} showThinking={true} />);
    expect(screen.getByText(/error/i)).toBeDefined();
  });

  it("renders an orphan turn with fallback header text", () => {
    const asst = assistantEvent([{ type: "text", text: "boot sequence" }]);
    const turn: Turn = {
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
    render(<TurnBlock turn={turn} showThinking={true} />);
    expect(screen.getByText(/boot sequence/)).toBeDefined();
  });

  it("exposes the duration + time on the header", () => {
    const prompt = userEvent2("time test");
    const turn = turnOf(prompt, [assistantEvent([{ type: "text", text: "ok" }])]);
    render(<TurnBlock turn={turn} showThinking={true} />);
    const header = screen.getByRole("button", { name: /time test/ });
    expect(within(header).getByText(/\d+ms|\d+\.\d+s/)).toBeDefined();
  });
});
