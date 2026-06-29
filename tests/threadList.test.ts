import { describe, expect, it } from "vitest";
import { listAllCodexThreads } from "../server/threadList.js";

describe("Codex thread list pagination", () => {
  it("collects every page until Codex returns no next cursor", async () => {
    const calls: unknown[] = [];
    const bridge = {
      async request(method: string, params: unknown) {
        calls.push({ method, params });
        const cursor = (params as { cursor?: string | null }).cursor ?? null;
        if (cursor === null) {
          return { data: [{ id: "first" }], nextCursor: "page-2", backwardsCursor: "back-1" };
        }
        if (cursor === "page-2") {
          return { data: [{ id: "second" }], nextCursor: "page-3", backwardsCursor: "back-2" };
        }
        return { data: [{ id: "third" }], nextCursor: null, backwardsCursor: "back-3" };
      }
    };

    const result = await listAllCodexThreads(bridge, {
      cwd: "/Volumes/DevDrive/program/demo",
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      searchTerm: null,
      useStateDbOnly: false
    });

    expect(result.data.map((thread) => (thread as { id: string }).id)).toEqual(["first", "second", "third"]);
    expect(result.nextCursor).toBeNull();
    expect(result.backwardsCursor).toBe("back-1");
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => (call as { params: { cursor?: string | null } }).params.cursor ?? null)).toEqual([
      null,
      "page-2",
      "page-3"
    ]);
  });

  it("fails instead of looping forever when Codex repeats a cursor", async () => {
    const bridge = {
      async request() {
        return { data: [], nextCursor: "same-cursor", backwardsCursor: null };
      }
    };

    await expect(listAllCodexThreads(bridge, { limit: 100 })).rejects.toThrow(/repeated thread list cursor/);
  });
});
