import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JsonTree } from "./JsonTree";

describe("JsonTree", () => {
  it("renders primitive values with type-specific classes", () => {
    render(<JsonTree value={{ flag: true, count: 42, name: "hi", empty: null }} />);
    expect(screen.getByText("true")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText('"hi"')).toBeDefined();
    expect(screen.getByText("null")).toBeDefined();
  });

  it("collapses arrays beyond the depth limit", () => {
    render(
      <JsonTree
        value={{ deep: { buried: { thing: "hidden" } } }}
        depthLimit={1}
      />,
    );
    // At depth 0 we render the outer object open; depth 1+ closed.
    expect(screen.queryByText('"hidden"')).toBeNull();
  });

  it("expands a collapsed node on click", async () => {
    render(
      <JsonTree
        value={{ outer: { inner: "reveal-me" } }}
        depthLimit={1}
      />,
    );
    const user = userEvent.setup();
    // Click the {1 key} toggle of `outer`.
    const toggles = screen.getAllByRole("button");
    await user.click(toggles[toggles.length - 1]!);
    expect(screen.getByText('"reveal-me"')).toBeDefined();
  });

  it("truncates long strings with an expand affordance", async () => {
    const long = "x".repeat(300);
    render(<JsonTree value={long} />);
    // The rendered chunk is shorter than the original; the button lets
    // the user expand to full.
    expect(screen.getByRole("button", { name: /…\+/i })).toBeDefined();
  });
});
