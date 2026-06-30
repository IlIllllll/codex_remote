import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import type { CodexBridge } from "./codexBridge.js";
import { DEFAULT_USER_ID, type ProjectStore } from "./db.js";
import { LiveStateStore } from "./liveState.js";
import type { Project, SocketClientMessage, SocketServerMessage } from "./types.js";

const commandSchema = z.array(z.string()).min(1);

function send(ws: WebSocket, message: SocketServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(wss: WebSocketServer, message: SocketServerMessage): void {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

function textInput(prompt: string) {
  return [{ type: "text", text: prompt, text_elements: [] }];
}

function sandboxPolicy(project: Project, mode = project.defaultSandbox) {
  if (mode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (mode === "read-only") {
    return { type: "readOnly", networkAccess: false };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [project.rootPath],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

function pickString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function pickBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickSandbox(value: unknown, fallback: Project["defaultSandbox"]): Project["defaultSandbox"] {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  return fallback;
}

function pickReasoningEffort(value: unknown, fallback: Project["defaultReasoningEffort"]): Project["defaultReasoningEffort"] {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return fallback;
}

function pickUserId(value: unknown): string {
  return pickString(value, DEFAULT_USER_ID).trim() || DEFAULT_USER_ID;
}

function getProjectOrThrow(store: ProjectStore, projectId: unknown, userId: string): Project {
  const id = pickString(projectId);
  const project = store.getProject(id, userId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return project;
}

export function attachSocketServer(httpServer: HttpServer, bridge: CodexBridge, store: ProjectStore): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const liveState = new LiveStateStore();

  bridge.on("notification", (message) => {
    liveState.recordNotification(message);
    broadcast(wss, { type: "codex.notification", data: message });

    const maybe = message as { method?: string; params?: { processId?: string; deltaBase64?: string; stream?: string } };
    if (maybe.method === "command/exec/outputDelta" && maybe.params?.deltaBase64) {
      broadcast(wss, {
        type: "terminal.output",
        data: {
          processId: maybe.params.processId,
          stream: maybe.params.stream,
          text: Buffer.from(maybe.params.deltaBase64, "base64").toString("utf8")
        }
      });
    }
  });

  bridge.on("serverRequest", (request) => {
    broadcast(wss, { type: "codex.serverRequest", data: request });
  });

  bridge.on("stderr", (text) => {
    broadcast(wss, { type: "codex.stderr", data: text });
  });

  bridge.on("status", (status) => {
    broadcast(wss, { type: "codex.status", data: status });
  });

  wss.on("connection", (ws) => {
    send(ws, {
      type: "hello",
      ok: true,
      data: {
        pendingServerRequests: bridge.getPendingServerRequests(),
        liveState: liveState.snapshot()
      }
    });

    ws.on("message", (raw) => {
      void handleClientMessage(ws, bridge, store, liveState, raw.toString("utf8"));
    });
  });

  return wss;
}

async function handleClientMessage(
  ws: WebSocket,
  bridge: CodexBridge,
  store: ProjectStore,
  liveState: LiveStateStore,
  raw: string
): Promise<void> {
  let message: SocketClientMessage;
  try {
    message = JSON.parse(raw) as SocketClientMessage;
  } catch {
    send(ws, { type: "error", ok: false, error: "Invalid JSON message." });
    return;
  }

  const requestId = message.requestId ?? randomUUID();

  try {
    switch (message.type) {
      case "live.state": {
        send(ws, { type: "live.state", requestId, ok: true, data: liveState.snapshot() });
        break;
      }

      case "thread.start": {
        const project = getProjectOrThrow(store, message.projectId, pickUserId(message.userId));
        const prompt = pickString(message.prompt).trim();
        if (!prompt) {
          throw new Error("Prompt is required.");
        }
        const thread = await bridge.request("thread/start", {
          cwd: project.rootPath,
          model: pickString(message.model, project.defaultModel) || null,
          approvalPolicy: pickString(message.approvalPolicy, project.defaultApprovalPolicy),
          sandbox: pickString(message.sandbox, project.defaultSandbox),
          threadSource: "user"
        });
        const threadId = (thread as { thread?: { id?: string } }).thread?.id;
        if (!threadId) {
          throw new Error("Codex did not return a thread id.");
        }
        const turn = await bridge.request("turn/start", {
          threadId,
          input: textInput(prompt),
          cwd: project.rootPath,
          approvalPolicy: pickString(message.approvalPolicy, project.defaultApprovalPolicy),
          sandboxPolicy: sandboxPolicy(project, pickSandbox(message.sandbox, project.defaultSandbox)),
          model: pickString(message.model, project.defaultModel) || null,
          effort: pickReasoningEffort(message.reasoningEffort, project.defaultReasoningEffort)
        });
        send(ws, { type: "ack", requestId, ok: true, data: { thread, turn } });
        break;
      }

      case "turn.start": {
        const project = getProjectOrThrow(store, message.projectId, pickUserId(message.userId));
        const threadId = pickString(message.threadId);
        const prompt = pickString(message.prompt).trim();
        if (!threadId || !prompt) {
          throw new Error("threadId and prompt are required.");
        }
        await bridge.request("thread/resume", {
          threadId,
          cwd: project.rootPath,
          model: pickString(message.model, project.defaultModel) || null,
          approvalPolicy: pickString(message.approvalPolicy, project.defaultApprovalPolicy),
          sandbox: pickString(message.sandbox, project.defaultSandbox)
        });
        const turn = await bridge.request("turn/start", {
          threadId,
          input: textInput(prompt),
          cwd: project.rootPath,
          approvalPolicy: pickString(message.approvalPolicy, project.defaultApprovalPolicy),
          sandboxPolicy: sandboxPolicy(project, pickSandbox(message.sandbox, project.defaultSandbox)),
          model: pickString(message.model, project.defaultModel) || null,
          effort: pickReasoningEffort(message.reasoningEffort, project.defaultReasoningEffort)
        });
        send(ws, { type: "ack", requestId, ok: true, data: { turn } });
        break;
      }

      case "turn.steer": {
        const threadId = pickString(message.threadId);
        const expectedTurnId = pickString(message.expectedTurnId);
        const prompt = pickString(message.prompt).trim();
        if (!threadId || !expectedTurnId || !prompt) {
          throw new Error("threadId, expectedTurnId, and prompt are required.");
        }
        const result = await bridge.request("turn/steer", {
          threadId,
          expectedTurnId,
          input: textInput(prompt)
        });
        send(ws, { type: "ack", requestId, ok: true, data: result });
        break;
      }

      case "turn.interrupt": {
        const threadId = pickString(message.threadId);
        const turnId = pickString(message.turnId);
        if (!threadId || !turnId) {
          throw new Error("threadId and turnId are required.");
        }
        const result = await bridge.request("turn/interrupt", { threadId, turnId });
        send(ws, { type: "ack", requestId, ok: true, data: result });
        break;
      }

      case "command.exec": {
        const project = getProjectOrThrow(store, message.projectId, pickUserId(message.userId));
        const command = commandSchema.parse(message.command);
        const processId = pickString(message.processId, `cmd-${randomUUID()}`);
        const result = await bridge.request(
          "command/exec",
          {
            command,
            processId,
            tty: pickBoolean(message.tty, true),
            streamStdin: true,
            streamStdoutStderr: true,
            disableTimeout: pickBoolean(message.disableTimeout, false),
            timeoutMs: pickBoolean(message.disableTimeout, false) ? undefined : 120_000,
            cwd: pickString(message.cwd, project.rootPath),
            size: message.size ?? { cols: 100, rows: 28 },
            sandboxPolicy: sandboxPolicy(project, pickSandbox(message.sandbox, project.defaultSandbox))
          },
          pickBoolean(message.disableTimeout, false) ? 86_400_000 : 180_000
        );
        send(ws, { type: "ack", requestId, ok: true, data: { processId, result } });
        break;
      }

      case "command.write": {
        const processId = pickString(message.processId);
        const data = pickString(message.data);
        if (!processId) {
          throw new Error("processId is required.");
        }
        const result = await bridge.request("command/exec/write", { processId, data });
        send(ws, { type: "ack", requestId, ok: true, data: result });
        break;
      }

      case "command.terminate": {
        const processId = pickString(message.processId);
        if (!processId) {
          throw new Error("processId is required.");
        }
        const result = await bridge.request("command/exec/terminate", { processId });
        send(ws, { type: "ack", requestId, ok: true, data: result });
        break;
      }

      case "approval.respond": {
        const responseId = message.codexRequestId as number | string | undefined;
        if (responseId === undefined) {
          throw new Error("codexRequestId is required.");
        }
        bridge.respondToServerRequest(responseId, message.result);
        send(ws, { type: "ack", requestId, ok: true });
        break;
      }

      default:
        throw new Error(`Unsupported socket message type: ${message.type}`);
    }
  } catch (error) {
    send(ws, {
      type: "ack",
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
