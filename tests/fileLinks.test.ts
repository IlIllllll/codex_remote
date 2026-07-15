import { describe, expect, it } from "vitest";
import { fileTargetFromHref } from "../src/fileLinks.js";

const location = { href: "http://127.0.0.1:4573/", origin: "http://127.0.0.1:4573" };

describe("fileTargetFromHref", () => {
  it("maps same-origin links to previewable file paths", () => {
    expect(fileTargetFromHref("http://127.0.0.1:4573/project/readme.md#usage", location)).toBe(
      "/project/readme.md#usage"
    );
    expect(fileTargetFromHref("docs/readme.md", location)).toBe("docs/readme.md");
  });

  it("treats external and malformed URLs as ordinary links without throwing", () => {
    expect(fileTargetFromHref("https://example.com/file.md", location)).toBeNull();
    expect(fileTargetFromHref("http://[invalid", location)).toBeNull();
  });
});
