import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readThreadFromJsonl, threadJsonlPathFromError } from "../server/threadFallback.js";

function writeCodexSession(root: string, lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(root, "codex-web-test-"));
  const filePath = path.join(dir, "rollout-2026-06-29T17-38-27-test-thread.jsonl");
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return filePath;
}

describe("JSONL thread fallback", () => {
  it("extracts a safe Codex session path from app-server read errors", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-sessions-"));
    const filePath = path.join(root, "2026", "06", "29", "rollout-test.jsonl");
    expect(threadJsonlPathFromError(new Error(`failed to read thread ${filePath}: rollout does not start`), root)).toBe(filePath);
    expect(threadJsonlPathFromError(new Error("failed to read thread /tmp/rollout-test.jsonl: nope"))).toBeNull();
  });

  it("parses turns and visible items from a Codex JSONL session", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-sessions-"));
    const filePath = writeCodexSession(root, [
      {
        timestamp: "2026-06-29T09:38:53.595Z",
        type: "session_meta",
        payload: {
          session_id: "test-thread",
          id: "test-thread",
          timestamp: "2026-06-29T09:38:27.790Z",
          cwd: "/Volumes/DevDrive/program/raspberry-ego",
          cli_version: "0.142.3",
          source: "vscode",
          thread_source: "user",
          model_provider: "openai"
        }
      },
      {
        timestamp: "2026-06-29T09:38:53.596Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1", started_at: 1782725933 }
      },
      {
        timestamp: "2026-06-29T09:38:53.602Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/Volumes/DevDrive/program/raspberry-ego</cwd>\n</environment_context>" }],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" }
        }
      },
      {
        timestamp: "2026-06-29T09:38:53.603Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "检查仓库是否最新\n" }],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" }
        }
      },
      {
        timestamp: "2026-06-29T09:38:53.609Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "output_text", text: "我来检查。" }],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" }
        }
      },
      {
        timestamp: "2026-06-29T09:38:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          id: "call-1",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git status --short" }),
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" }
        }
      },
      {
        timestamp: "2026-06-29T09:39:10.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1", completed_at: 1782726010, duration_ms: 1000 }
      }
    ]);

    const response = await readThreadFromJsonl(filePath, "test-thread", root);
    const thread = response.thread as { id: string; name: string; turns: Array<{ items: Array<{ type: string; text?: string; command?: string }> }> };

    expect(thread.id).toBe("test-thread");
    expect(thread.name).toBe("检查仓库是否最新");
    expect(thread.turns).toHaveLength(1);
    expect(thread.turns[0].items.map((item) => item.type)).toEqual(["userMessage", "agentMessage", "toolCall"]);
    expect(thread.turns[0].items[2].command).toBe("git status --short");
  });
});
