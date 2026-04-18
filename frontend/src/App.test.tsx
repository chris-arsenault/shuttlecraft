import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("is a function", () => {
    expect(typeof App).toBe("function");
  });
});
