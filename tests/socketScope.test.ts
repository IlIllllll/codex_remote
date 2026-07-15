import { describe, expect, it } from "vitest";
import { notificationThreadId, scopeMatchesThread } from "../server/socketScope.js";

describe("socket thread scope", () => {
  it("extracts thread ids from supported Codex notification shapes", () => {
    expect(notificationThreadId({ params: { threadId: "thread-direct" } })).toBe("thread-direct");
    expect(notificationThreadId({ params: { thread: { id: "thread-object" } } })).toBe("thread-object");
    expect(notificationThreadId({ params: { turn: { threadId: "thread-turn" } } })).toBe("thread-turn");
    expect(notificationThreadId({ params: {} })).toBeNull();
  });

  it("matches notifications only to clients viewing that thread", () => {
    const scope = { userId: "user-1", projectId: "project-1", threadId: "thread-1" };
    expect(scopeMatchesThread(scope, "thread-1")).toBe(true);
    expect(scopeMatchesThread(scope, "thread-2")).toBe(false);
    expect(scopeMatchesThread(undefined, "thread-1")).toBe(false);
  });
});
