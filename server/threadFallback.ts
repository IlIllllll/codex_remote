import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type JsonObject = Record<string, unknown>;

interface JsonlRecord {
  timestamp?: string;
  type?: string;
  payload?: JsonObject;
}

interface FallbackTurn {
  id: string;
  items: JsonObject[];
  itemsView: string;
  status: string;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

const codexSessionsRoot = path.join(os.homedir(), ".codex", "sessions");

function secondsFromIso(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const value = part as { text?: unknown };
      return typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

function commandTextFromArguments(argumentsJson: unknown): string {
  const args = parseJsonObject(argumentsJson);
  if (!args) {
    return "";
  }
  if (typeof args.cmd === "string") {
    return args.cmd;
  }
  if (Array.isArray(args.command)) {
    return args.command.map(String).join(" ");
  }
  return JSON.stringify(args, null, 2);
}

function getTurnId(payload: JsonObject, currentTurnId: string | null): string | null {
  const metadata = payload.internal_chat_message_metadata_passthrough;
  if (metadata && typeof metadata === "object" && "turn_id" in metadata) {
    const turnId = (metadata as { turn_id?: unknown }).turn_id;
    if (typeof turnId === "string" && turnId) {
      return turnId;
    }
  }
  return currentTurnId;
}

function shouldSkipMessage(payload: JsonObject): boolean {
  if (payload.role === "developer") {
    return true;
  }
  const text = textFromContent(payload.content);
  return payload.role === "user" && text.trim().startsWith("<environment_context>");
}

function appendResponseItem(turn: FallbackTurn, payload: JsonObject, nextId: () => string): void {
  const itemType = payload.type;

  if (itemType === "message") {
    if (shouldSkipMessage(payload)) {
      return;
    }
    const text = textFromContent(payload.content);
    if (!text.trim()) {
      return;
    }
    const id = typeof payload.id === "string" ? payload.id : nextId();
    if (payload.role === "assistant") {
      turn.items.push({
        type: "agentMessage",
        id,
        text,
        phase: payload.phase
      });
      return;
    }
    if (payload.role === "user") {
      turn.items.push({
        type: "userMessage",
        id,
        content: [{ type: "text", text, text_elements: [] }]
      });
    }
    return;
  }

  if (itemType === "function_call") {
    const id = typeof payload.id === "string" ? payload.id : nextId();
    const command = commandTextFromArguments(payload.arguments);
    turn.items.push({
      type: "toolCall",
      id,
      tool: payload.name,
      command: command || undefined,
      text: command || String(payload.name ?? "tool call")
    });
    return;
  }

  if (itemType === "function_call_output") {
    const callId = typeof payload.call_id === "string" ? payload.call_id : nextId();
    const output = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output ?? "", null, 2);
    turn.items.push({
      type: "toolCallOutput",
      id: `${callId}-output-${turn.items.length + 1}`,
      text: callId,
      aggregatedOutput: output
    });
    return;
  }

  if (itemType === "reasoning" && Array.isArray(payload.summary) && payload.summary.length > 0) {
    const id = typeof payload.id === "string" ? payload.id : nextId();
    turn.items.push({
      type: "reasoning",
      id,
      summary: payload.summary
    });
  }
}

function isSafeCodexSessionPath(filePath: string, sessionsRoot = codexSessionsRoot): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(sessionsRoot);
  return resolved.startsWith(`${root}${path.sep}`) && resolved.endsWith(".jsonl");
}

export function threadJsonlPathFromError(error: unknown, sessionsRoot = codexSessionsRoot): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/failed to read thread ([^:]+\.jsonl):/);
  if (!match) {
    return null;
  }
  const filePath = match[1];
  return isSafeCodexSessionPath(filePath, sessionsRoot) ? filePath : null;
}

export async function readThreadFromJsonl(
  filePath: string,
  threadId: string,
  sessionsRoot = codexSessionsRoot
): Promise<{ thread: JsonObject }> {
  if (!isSafeCodexSessionPath(filePath, sessionsRoot)) {
    throw new Error("Refusing to read a thread outside the Codex sessions directory.");
  }

  const raw = await fs.readFile(filePath, "utf8");
  const turns = new Map<string, FallbackTurn>();
  let metadata: JsonObject | null = null;
  let currentTurnId: string | null = null;
  let itemCount = 0;
  let preview = "";
  let updatedAt = 0;

  const nextId = () => `fallback-item-${++itemCount}`;
  const ensureTurn = (turnId: string): FallbackTurn => {
    let turn = turns.get(turnId);
    if (!turn) {
      turn = {
        id: turnId,
        items: [],
        itemsView: "default",
        status: "running",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null
      };
      turns.set(turnId, turn);
    }
    return turn;
  };

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const record = JSON.parse(line) as JsonlRecord;
    const payload = record.payload ?? {};
    updatedAt = Math.max(updatedAt, secondsFromIso(record.timestamp) ?? 0);

    if (record.type === "session_meta") {
      metadata = payload;
      updatedAt = Math.max(updatedAt, secondsFromIso(payload.timestamp) ?? 0);
      continue;
    }

    if (record.type === "turn_context" && typeof payload.turn_id === "string") {
      currentTurnId = payload.turn_id;
      const turn = ensureTurn(currentTurnId);
      turn.startedAt ??= secondsFromIso(record.timestamp);
      continue;
    }

    if (record.type === "event_msg") {
      if (payload.type === "task_started" && typeof payload.turn_id === "string") {
        currentTurnId = payload.turn_id;
        const turn = ensureTurn(currentTurnId);
        turn.startedAt = typeof payload.started_at === "number" ? payload.started_at : secondsFromIso(record.timestamp);
      }
      if (payload.type === "task_complete" && typeof payload.turn_id === "string") {
        const turn = ensureTurn(payload.turn_id);
        turn.status = "completed";
        turn.completedAt = typeof payload.completed_at === "number" ? payload.completed_at : secondsFromIso(record.timestamp);
        turn.durationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : null;
        updatedAt = Math.max(updatedAt, turn.completedAt ?? 0);
      }
      if (payload.type === "user_message" && typeof payload.message === "string" && !preview) {
        preview = payload.message.trim();
      }
      continue;
    }

    if (record.type === "response_item") {
      const turnId = getTurnId(payload, currentTurnId);
      if (!turnId) {
        continue;
      }
      const turn = ensureTurn(turnId);
      appendResponseItem(turn, payload, nextId);
      if (!preview && payload.type === "message" && payload.role === "user" && !shouldSkipMessage(payload)) {
        preview = textFromContent(payload.content).trim();
      }
    }
  }

  if (!metadata) {
    throw new Error("Codex JSONL thread is missing session metadata.");
  }

  const createdAt = secondsFromIso(metadata.timestamp) ?? secondsFromIso((metadata as { created_at?: unknown }).created_at) ?? updatedAt;
  const orderedTurns = Array.from(turns.values()).map((turn) => ({
    ...turn,
    status: turn.status === "running" && turn.completedAt ? "completed" : turn.status
  }));
  const name = preview ? preview.split(/\r?\n/)[0].slice(0, 80) : null;

  return {
    thread: {
      id: typeof metadata.id === "string" ? metadata.id : threadId,
      sessionId: typeof metadata.session_id === "string" ? metadata.session_id : typeof metadata.id === "string" ? metadata.id : threadId,
      forkedFromId: null,
      parentThreadId: null,
      preview,
      ephemeral: false,
      modelProvider: metadata.model_provider ?? null,
      createdAt,
      updatedAt: updatedAt || createdAt,
      status: { type: "recoveredFromJsonl" },
      path: filePath,
      cwd: metadata.cwd,
      cliVersion: metadata.cli_version,
      source: metadata.source,
      threadSource: metadata.thread_source ?? null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name,
      turns: orderedTurns
    }
  };
}
