import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../server/db.js";

const stores: ProjectStore[] = [];

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-db-"));
  const store = new ProjectStore(path.join(dir, "test.sqlite"));
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe("ProjectStore", () => {
  it("creates and lists projects", () => {
    const store = createStore();
    const project = store.createProject({
      name: "Demo",
      rootPath: "/Volumes/DevDrive/program/demo"
    });

    expect(project.id).toBeTruthy();
    expect(store.listProjects()).toHaveLength(1);
    expect(store.getProject(project.id)?.name).toBe("Demo");
  });

  it("updates and deletes projects", () => {
    const store = createStore();
    const project = store.createProject({
      name: "Demo",
      rootPath: "/Volumes/DevDrive/program/demo"
    });

    expect(store.updateProject(project.id, { name: "Renamed" })?.name).toBe("Renamed");
    expect(store.deleteProject(project.id)).toBe(true);
    expect(store.getProject(project.id)).toBeNull();
  });

  it("scopes project visibility by user", () => {
    const store = createStore();
    const alice = store.createUser("Alice");
    const bob = store.createUser("Bob");

    const aliceProject = store.createProject({
      userId: alice.id,
      name: "Shared Path",
      rootPath: "/Volumes/DevDrive/program/shared"
    });
    const bobProject = store.createProject({
      userId: bob.id,
      name: "Shared Path",
      rootPath: "/Volumes/DevDrive/program/shared"
    });

    expect(store.listProjects(alice.id).map((project) => project.id)).toEqual([aliceProject.id]);
    expect(store.listProjects(bob.id).map((project) => project.id)).toEqual([bobProject.id]);
    expect(store.getProject(bobProject.id, alice.id)).toBeNull();
  });
});
