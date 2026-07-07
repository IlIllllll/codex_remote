import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listBrowsableDirectories } from "../server/directoryBrowser.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-dirs-"));
  fs.mkdirSync(path.join(root, "alpha"));
  fs.mkdirSync(path.join(root, "beta"));
  fs.writeFileSync(path.join(root, "notes.txt"), "not a directory");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("listBrowsableDirectories", () => {
  it("lists directories under the configured root", () => {
    const result = listBrowsableDirectories(undefined, root, { allowOutsideRoot: false });

    expect(result.rootPath).toBe(fs.realpathSync(root));
    expect(result.currentPath).toBe(fs.realpathSync(root));
    expect(result.parentPath).toBeNull();
    expect(result.directories.map((entry) => entry.name)).toEqual(["alpha", "beta"]);
  });

  it("accepts relative paths inside the configured root", () => {
    fs.mkdirSync(path.join(root, "alpha", "child"));

    const result = listBrowsableDirectories("alpha", root, { allowOutsideRoot: false });

    expect(result.currentPath).toBe(fs.realpathSync(path.join(root, "alpha")));
    expect(result.parentPath).toBe(fs.realpathSync(root));
    expect(result.directories).toMatchObject([{ name: "child" }]);
  });

  it("rejects paths outside the configured root", () => {
    expect(() => listBrowsableDirectories("..", root, { allowOutsideRoot: false })).toThrow(/must stay under/);
    expect(() => listBrowsableDirectories(path.dirname(root), root, { allowOutsideRoot: false })).toThrow(/must stay under/);
  });

  it("can browse above the configured root when outside roots are enabled", () => {
    const parent = fs.realpathSync(path.dirname(root));
    const result = listBrowsableDirectories("..", root, { allowOutsideRoot: true });

    expect(result.rootPath).toBe(path.parse(root).root);
    expect(result.currentPath).toBe(parent);
    expect(result.parentPath).toBe(path.dirname(parent));
    expect(result.directories.some((entry) => entry.path === fs.realpathSync(root))).toBe(true);
  });
});
