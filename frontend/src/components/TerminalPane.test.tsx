import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

// xterm.js depends on canvas/layout APIs that happy-dom doesn't fully
// implement. We mock just enough to verify the component wires up the
// WebSocket connection and passes bytes through to xterm.write.

const writes: Array<string | Uint8Array> = [];
const dataHandlers: Array<(d: string) => void> = [];
const mockTerm = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  write: vi.fn((chunk: string | Uint8Array) => writes.push(chunk)),
  onData: vi.fn((handler: (d: string) => void) => {
    dataHandlers.push(handler);
    return { dispose: vi.fn() };
  }),
  cols: 80,
  rows: 24,
  dispose: vi.fn(),
};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(() => mockTerm),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({ fit: vi.fn() })),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Also mock the WS module so we can drive it imperatively.
const mockConn = {
  sendInput: vi.fn(),
  sendResize: vi.fn(),
  close: vi.fn(),
  state: vi.fn(() => "open"),
};
const connectPtyMock = vi.fn();
vi.mock("../api/ws", () => ({
  connectPty: (...args: Parameters<typeof connectPtyMock>) => connectPtyMock(...args),
}));

import { TerminalPane } from "./TerminalPane";

describe("TerminalPane", () => {
  beforeEach(() => {
    writes.length = 0;
    dataHandlers.length = 0;
    vi.clearAllMocks();
    connectPtyMock.mockImplementation((_sessionId, handlers) => {
      // Expose handlers back to the test so we can simulate server events.
      (connectPtyMock as unknown as { last: unknown }).last = handlers;
      return mockConn;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires WebSocket bytes into term.write", async () => {
    render(<TerminalPane sessionId="abc" />);
    await waitFor(() => {
      expect(connectPtyMock).toHaveBeenCalled();
    });
    const handlers = (connectPtyMock as unknown as { last: { onBytes: (c: Uint8Array) => void } })
      .last;
    handlers.onBytes(new Uint8Array([104, 105])); // "hi"
    expect(mockTerm.write).toHaveBeenCalled();
    expect(writes[0]).toEqual(new Uint8Array([104, 105]));
  });

  it("routes xterm keystrokes into conn.sendInput", async () => {
    render(<TerminalPane sessionId="abc" />);
    await waitFor(() => {
      expect(dataHandlers.length).toBeGreaterThan(0);
    });
    dataHandlers[0]!("ls\n");
    expect(mockConn.sendInput).toHaveBeenCalledWith("ls\n");
  });

  it("shows exit banner when the server reports dead", async () => {
    const { findByText } = render(<TerminalPane sessionId="abc" />);
    await waitFor(() => {
      expect(connectPtyMock).toHaveBeenCalled();
    });
    const handlers = (connectPtyMock as unknown as { last: { onServerMsg: (m: unknown) => void } })
      .last;
    handlers.onServerMsg({ t: "dead", exit: 0 });
    expect(await findByText(/shell exited/)).toBeDefined();
  });

  it("does not rewire on irrelevant re-renders; remounts on sessionId change", async () => {
    const { rerender } = render(<TerminalPane sessionId="a" />);
    await waitFor(() => expect(connectPtyMock).toHaveBeenCalledTimes(1));
    // Same sessionId — should not reconnect.
    rerender(<TerminalPane sessionId="a" />);
    expect(connectPtyMock).toHaveBeenCalledTimes(1);
    // Different sessionId — must reconnect.
    rerender(<TerminalPane sessionId="b" />);
    await waitFor(() => expect(connectPtyMock).toHaveBeenCalledTimes(2));
  });
});
