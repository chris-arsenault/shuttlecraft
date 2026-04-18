import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const event = (offset: number, kind: string, text: string) => ({
  byte_offset: offset,
  timestamp: new Date(offset * 1000).toISOString(),
  kind,
  payload: {
    type: kind,
    message: {
      role: kind,
      content: [{ type: "text", text }],
    },
  },
});

describe("TimelinePane", () => {
  beforeEach(() => {
    // Use real timers: fake timers combined with userEvent's internal
    // scheduling produces brittle tests here. Polling behavior is
    // verified end-to-end; per-interval timing is not a unit concern.
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders fetched events and expands on click", async () => {
    const body = JSON.stringify({
      claude_session_uuid: "00000000-0000-0000-0000-000000000001",
      events: [event(0, "user", "hello"), event(120, "assistant", "hi there")],
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
      expect(screen.getByText("hello")).toBeDefined();
      expect(screen.getByText("hi there")).toBeDefined();
    });
    expect(screen.getByText(/2 events/)).toBeDefined();

    const user = userEvent.setup();
    await user.click(screen.getAllByText("hello")[0]!.closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("raw")).toBeDefined();
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
              events: [event(0, "user", "one")],
              next_after: 0,
            }
          : {
              claude_session_uuid: "00000000-0000-0000-0000-000000000001",
              events: [event(1, "assistant", "two")],
              next_after: 1,
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(<TimelinePane sessionId="abc" />);
    await waitFor(() => expect(screen.getByText("one")).toBeDefined());
    // Wait for the next poll. Poll interval is 1500ms; allow slack.
    await waitFor(() => expect(screen.getByText("two")).toBeDefined(), {
      timeout: 3500,
    });
    expect(urls[0]).toMatch(/\/api\/sessions\/abc\/history$/);
    expect(urls.some((u) => /after=0/.test(u))).toBe(true);
  });
});
