import { describe, expect, it } from "vitest";

import { sanitizePaste } from "./clipboard";

describe("sanitizePaste", () => {
  it("strips zero-width and BOM characters", () => {
    const dirty = "hel\u200Blo\u200Cworld\uFEFF!";
    expect(sanitizePaste(dirty)).toBe("helloworld!");
  });

  it("normalizes CRLF to LF", () => {
    expect(sanitizePaste("line1\r\nline2\r\nline3")).toBe(
      "line1\nline2\nline3",
    );
  });

  it("normalizes bare CR to LF", () => {
    expect(sanitizePaste("line1\rline2")).toBe("line1\nline2");
  });

  it("preserves normal text", () => {
    expect(sanitizePaste("git status\n")).toBe("git status\n");
  });

  it("strips word-joiner (U+2060) and Mongolian vowel separator (U+180E)", () => {
    expect(sanitizePaste("ab\u2060cd\u180Eef")).toBe("abcdef");
  });
});
