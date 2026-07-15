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

  it("removes active turns and matching deltas after completion", () => {
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
    expect(snapshot.agentMessages).toEqual([]);
  });

  it("returns live state only for the requested thread", () => {
    const store = new LiveStateStore();

    store.recordNotification({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    store.recordNotification({ method: "turn/started", params: { threadId: "thread-2", turn: { id: "turn-2" } } });
    store.recordNotification({
      method: "item/agentMessage/delta",
      params: { itemId: "item-1", threadId: "thread-1", turnId: "turn-1", delta: "first" }
    });
    store.recordNotification({
      method: "item/agentMessage/delta",
      params: { itemId: "item-2", threadId: "thread-2", turnId: "turn-2", delta: "second" }
    });

    expect(store.snapshot("thread-1").agentMessages.map((message) => message.itemId)).toEqual(["item-1"]);
    expect(store.snapshot("thread-1").activeTurns.map((turn) => turn.turnId)).toEqual(["turn-1"]);
    expect(store.snapshot(null)).toMatchObject({ agentMessages: [], activeTurns: [] });
  });

  it("ignores malformed delta notifications", () => {
    const store = new LiveStateStore();

    store.recordNotification({ method: "item/agentMessage/delta", params: { delta: "missing item" } });

    expect(store.snapshot().agentMessages).toEqual([]);
  });
});
