import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterChips } from "./FilterChips";
import { DEFAULT_FILTERS, useTimelineFilters } from "./filters";

function Host() {
  const hook = useTimelineFilters();
  return <FilterChips {...hook} />;
}

describe("FilterChips", () => {
  afterEach(() => window.localStorage.clear());

  it("renders speaker, tool, toggle, and file-path chips", () => {
    render(<Host />);
    expect(screen.getByRole("button", { name: /user/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^claude$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /tool result/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /errors only/i })).toBeDefined();
    expect(screen.getByPlaceholderText(/path substring/i)).toBeDefined();
  });

  it("toggles the speaker chip active state on click and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const userChip = screen.getByRole("button", { name: /^user$/i });
    expect(userChip.className).not.toContain("active");
    await user.click(userChip);
    expect(userChip.className).toContain("active");

    const stored = window.localStorage.getItem(
      "shuttlecraft.timeline.filters.v1",
    );
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.speakers).toContain("user");
  });

  it("Clear button appears once a filter is active and resets state", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    const clear = screen.getByRole("button", { name: /clear/i });
    await user.click(clear);
    // All chips return to inactive
    expect(
      screen.getByRole("button", { name: /^edit$/i }).className,
    ).not.toContain("active");
  });

  it("typing in the file-path input updates the filter state", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByPlaceholderText(/path substring/i);
    await user.type(input, "foo");
    expect((input as HTMLInputElement).value).toBe("foo");
  });

  it("toggling 'bookkeeping' updates the label", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const chip = screen.getByRole("button", { name: /bookkeeping hidden/i });
    await user.click(chip);
    expect(screen.getByRole("button", { name: /bookkeeping shown/i })).toBeDefined();
  });

  // Sanity check that the hook's defaults match what the chips expose
  it("default state has showThinking on, bookkeeping hidden, sidechain hidden", () => {
    expect(DEFAULT_FILTERS.showThinking).toBe(true);
    expect(DEFAULT_FILTERS.showBookkeeping).toBe(false);
    expect(DEFAULT_FILTERS.showSidechain).toBe(false);
  });
});
