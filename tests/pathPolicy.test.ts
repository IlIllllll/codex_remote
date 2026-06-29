import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureProjectDirectory, resolveProjectPath } from "../server/pathPolicy.js";

describe("path policy", () => {
  it("allows paths inside the configured root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    expect(resolveProjectPath(path.join(root, "demo"), root)).toBe(path.join(root, "demo"));
  });

  it("rejects paths outside the configured root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    expect(() => resolveProjectPath(path.dirname(root), root)).toThrow(/must stay under/);
  });

  it("creates missing project directories when requested", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    const target = path.join(root, "new-project");
    expect(ensureProjectDirectory(target, { create: true, allowedRoot: root })).toBe(target);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });
});
