import { describe, expect, it } from "vitest";
import { notificationMatchesThread, notificationThreadId } from "../src/threadNotifications.js";

describe("frontend thread notifications", () => {
  it("extracts a thread id without coercing missing values", () => {
    expect(notificationThreadId({ threadId: "thread-1" })).toBe("thread-1");
    expect(notificationThreadId({ thread: { id: "thread-2" } })).toBe("thread-2");
    expect(notificationThreadId({})).toBeNull();
  });

  it("rejects notifications for other or unknown threads", () => {
    expect(notificationMatchesThread({ threadId: "thread-1" }, "thread-1")).toBe(true);
    expect(notificationMatchesThread({ threadId: "thread-2" }, "thread-1")).toBe(false);
    expect(notificationMatchesThread({}, "thread-1")).toBe(false);
    expect(notificationMatchesThread({ threadId: "thread-1" }, null)).toBe(false);
  });
});
