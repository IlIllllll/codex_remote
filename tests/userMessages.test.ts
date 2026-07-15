import { describe, expect, it } from "vitest";
import { userMessageNeedsCollapse, userMessagePreview } from "../src/userMessages.js";

describe("user message folding", () => {
  it("normalizes multiline content into a single-line preview", () => {
    expect(userMessagePreview("first line\n\nsecond\tline")).toBe("first line second line");
  });

  it("folds multiline and long messages while leaving short messages expanded", () => {
    expect(userMessageNeedsCollapse("short request")).toBe(false);
    expect(userMessageNeedsCollapse("first line\nsecond line")).toBe(true);
    expect(userMessageNeedsCollapse("x".repeat(97))).toBe(true);
  });
});
