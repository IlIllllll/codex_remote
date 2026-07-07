import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureProjectDirectory, resolveProjectFilePath, resolveProjectPath } from "../server/pathPolicy.js";

describe("path policy", () => {
  it("allows paths inside the configured root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    expect(resolveProjectPath(path.join(root, "demo"), root)).toBe(path.join(root, "demo"));
  });

  it("rejects paths outside the configured root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    expect(() => resolveProjectPath(path.dirname(root), root)).toThrow(/must stay under/);
  });

  it("allows project roots outside the configured root when explicitly enabled", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-outside-"));
    expect(resolveProjectPath(outside, root, { allowOutsideRoot: true })).toBe(outside);
    expect(ensureProjectDirectory(outside, { allowedRoot: root, allowOutsideRoot: true })).toBe(outside);
  });

  it("creates missing project directories when requested", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    const target = path.join(root, "new-project");
    expect(ensureProjectDirectory(target, { create: true, allowedRoot: root })).toBe(target);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("resolves project file links with line suffixes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    const docs = path.join(root, "docs");
    fs.mkdirSync(docs);
    const filePath = path.join(docs, "data_conversion.md");
    fs.writeFileSync(filePath, "# Data\n");
    const resolved = resolveProjectFilePath(root, "docs/data_conversion.md:68", { allowedRoot: root });
    expect(resolved.filePath).toBe(fs.realpathSync(filePath));
    expect(resolved.relativePath).toBe("docs/data_conversion.md");
    expect(resolved.line).toBe(68);
  });

  it("rejects project file links outside the project root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-root-"));
    const outside = path.join(os.tmpdir(), `codex-web-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, "outside");
    expect(() => resolveProjectFilePath(root, outside, { allowedRoot: root })).toThrow(/inside the selected project/);
  });

  it("keeps file access inside the selected project when project roots may be outside the configured root", () => {
    const configuredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-config-root-"));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-project-root-"));
    const outside = path.join(os.tmpdir(), `codex-web-outside-file-${Date.now()}.txt`);
    fs.writeFileSync(outside, "outside");

    expect(() =>
      resolveProjectFilePath(projectRoot, outside, { allowedRoot: configuredRoot, allowOutsideRoot: true })
    ).toThrow(/inside the selected project/);
  });
});
