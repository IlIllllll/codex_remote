import { describe, expect, it } from "vitest";
import { LiveStateStore } from "../server/liveState.js";

describe("LiveStateStore", () => {
  it("accumulates streamed agent message deltas", () => {
    const store = new LiveStateStore();

    store.recordNotification({
      method: "item/agentMessage/delta",
      params: { itemId: "item-1", threadId: "thread-1", turnId: "turn-1", delta: "hello " }
    });
    store.recordNotification({
      method: "item/agentMessage/delta",
      params: { itemId: "item-1", threadId: "thread-1", turnId: "turn-1", delta: "world" }
    });

    expect(store.snapshot().agentMessages).toMatchObject([
      {
        itemId: "item-1",
        threadId: "thread-1",
        turnId: "turn-1",
        text: "hello world",
        completed: false
      }
    ]);
  });

  it("removes active turns and marks matching deltas complete", () => {
    const store = new LiveStateStore();

    store.recordNotification({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    store.recordNotification({
      method: "item/agentMessage/delta",
      params: { itemId: "item-1", threadId: "thread-1", turnId: "turn-1", delta: "streaming" }
    });

    expect(store.snapshot().activeTurns).toHaveLength(1);

    store.recordNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    const snapshot = store.snapshot();
    expect(snapshot.activeTurns).toEqual([]);
    expect(snapshot.agentMessages[0]).toMatchObject({ itemId: "item-1", completed: true, text: "streaming" });
  });

  it("ignores malformed delta notifications", () => {
    const store = new LiveStateStore();

    store.recordNotification({ method: "item/agentMessage/delta", params: { delta: "missing item" } });

    expect(store.snapshot().agentMessages).toEqual([]);
  });
});
