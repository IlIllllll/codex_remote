import { describe, expect, it } from "vitest";
import { classifyRpcEnvelope } from "../server/codexBridge.js";

describe("Codex JSON-RPC classification", () => {
  it("classifies client responses", () => {
    expect(classifyRpcEnvelope({ id: 1, result: { ok: true } })).toBe("response");
  });

  it("classifies server requests", () => {
    expect(classifyRpcEnvelope({ id: "approval-1", method: "item/commandExecution/requestApproval", params: {} })).toBe(
      "serverRequest"
    );
  });

  it("classifies notifications", () => {
    expect(classifyRpcEnvelope({ method: "turn/completed", params: {} })).toBe("notification");
  });
});
