import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Virtuoso does its own DOM measurement which happy-dom doesn't support.
// Stub it with a plain list so we can assert on rendered items directly.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (i: number, item: unknown) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}));

import { TimelinePane } from "./TimelinePane";

function stubHistoryFetch(
  handler: (url: string, init?: RequestInit) => Response,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      return handler(url, init);
    }),
  );
}

const mkUser = (offset: number, text: string) => ({
  byte_offset: offset,
  timestamp: new Date(offset * 1000).toISOString(),
  kind: "user",
  payload: {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  },
});

const mkAssistant = (offset: number, text: string) => ({
  byte_offset: offset,
  timestamp: new Date(offset * 1000).toISOString(),
  kind: "assistant",
  payload: {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  },
});

describe("TimelinePane", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("groups events into turns and expands the header on click", async () => {
    const body = JSON.stringify({
      claude_session_uuid: "00000000-0000-0000-0000-000000000001",
      events: [mkUser(0, "hello"), mkAssistant(120, "hi there")],
      next_after: 120,
    });
    stubHistoryFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    render(<TimelinePane sessionId="abc" />);

    await waitFor(() => {
      expect(screen.getByText(/hello/)).toBeDefined();
    });
    // Header shows turn + event counts
    expect(screen.getByText(/1 turn/)).toBeDefined();

    const user = userEvent.setup();
    // Click the turn header to expand and reveal the assistant text
    await user.click(screen.getByRole("button", { name: /hello/ }));
    await waitFor(() => {
      expect(screen.getByText("hi there")).toBeDefined();
    });
  });

  it("shows empty-state copy when the API returns no claude session", async () => {
    const body = JSON.stringify({
      claude_session_uuid: null,
      events: [],
      next_after: null,
    });
    stubHistoryFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    render(<TimelinePane sessionId="abc" />);
    await waitFor(() => {
      expect(screen.getByText(/no claude session correlated yet/i)).toBeDefined();
    });
  });

  it("subsequent polls include ?after=<last_offset>", async () => {
    let call = 0;
    const urls: string[] = [];
    stubHistoryFetch((url) => {
      urls.push(url);
      const body =
        call++ === 0
          ? {
              claude_session_uuid: "00000000-0000-0000-0000-000000000001",
              events: [mkUser(0, "one")],
              next_after: 0,
            }
          : {
              claude_session_uuid: "00000000-0000-0000-0000-000000000001",
              events: [mkUser(1, "two")],
              next_after: 1,
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<TimelinePane sessionId="abc" />);
    await waitFor(() => expect(screen.getByText(/one/)).toBeDefined());
    // Wait for the next poll. Poll interval is 1500ms; allow slack.
    await waitFor(() => expect(screen.getByText(/two/)).toBeDefined(), {
      timeout: 3500,
    });
    expect(urls[0]).toMatch(/\/api\/sessions\/abc\/history$/);
    expect(urls.some((u) => /after=0/.test(u))).toBe(true);
  });

  it("bookkeeping events are hidden by default", async () => {
    const body = JSON.stringify({
      claude_session_uuid: "00000000-0000-0000-0000-000000000001",
      events: [
        mkUser(0, "real prompt"),
        {
          byte_offset: 10,
          timestamp: "2025-01-01T00:00:10Z",
          kind: "file-history-snapshot",
          payload: { type: "file-history-snapshot" },
        },
        mkAssistant(20, "real reply"),
      ],
      next_after: 20,
    });
    stubHistoryFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    render(<TimelinePane sessionId="abc" />);
    await waitFor(() => expect(screen.getByText(/real prompt/)).toBeDefined());
    // Header reports 3 raw events but only one visible turn
    expect(screen.getByText(/1 turn/)).toBeDefined();
    expect(screen.getByText(/3 events/)).toBeDefined();
    expect(screen.queryByText(/file-history-snapshot/)).toBeNull();
  });
});
