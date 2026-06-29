import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { serverConfig } from "./config.js";
import type { RpcEnvelope } from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timer: NodeJS.Timeout;
}

interface ServerRequestRecord {
  id: number | string;
  method: string;
  params: unknown;
  receivedAt: string;
}

export function classifyRpcEnvelope(message: RpcEnvelope): "response" | "serverRequest" | "notification" {
  if (message.id !== undefined && !message.method) {
    return "response";
  }
  if (message.id !== undefined && message.method) {
    return "serverRequest";
  }
  return "notification";
}

export class CodexBridge extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private serverRequests = new Map<number | string, ServerRequestRecord>();
  private readyPromise: Promise<void> | null = null;
  private restarting = false;
  private stopped = false;

  start(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.stopped = false;
    this.readyPromise = this.spawnServer();
    return this.readyPromise;
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }

  async request(method: string, params?: unknown, timeoutMs = 120_000): Promise<unknown> {
    await this.start();
    return this.sendRequest(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params });
  }

  respondToServerRequest(id: number | string, result: unknown): void {
    if (!this.serverRequests.has(id)) {
      throw new Error(`Unknown Codex server request: ${id}`);
    }
    this.serverRequests.delete(id);
    this.write({ id, result });
  }

  rejectServerRequest(id: number | string, message: string): void {
    if (!this.serverRequests.has(id)) {
      throw new Error(`Unknown Codex server request: ${id}`);
    }
    this.serverRequests.delete(id);
    this.write({ id, error: { code: -32000, message } });
  }

  getPendingServerRequests(): ServerRequestRecord[] {
    return Array.from(this.serverRequests.values());
  }

  private async spawnServer(): Promise<void> {
    this.proc = spawn(serverConfig.codexBin, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    const proc = this.proc;
    const rl = readline.createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      this.handleLine(line);
    });

    proc.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString("utf8"));
    });

    proc.on("exit", (code, signal) => {
      this.emit("status", { state: "exited", code, signal });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Codex app-server exited while waiting for ${pending.method}.`));
      }
      this.pending.clear();
      this.proc = null;
      this.readyPromise = null;
      if (!this.stopped) {
        this.scheduleRestart();
      }
    });

    await this.sendRequest("initialize", {
      clientInfo: {
        name: "codex_web_console",
        title: "Codex Web Console",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify("initialized", {});
    this.emit("status", { state: "ready" });
  }

  private scheduleRestart(): void {
    if (this.restarting) {
      return;
    }
    this.restarting = true;
    setTimeout(() => {
      this.restarting = false;
      void this.start().catch((error) => {
        this.emit("errorEvent", String(error instanceof Error ? error.message : error));
      });
    }, 1_000);
  }

  private sendRequest(method: string, params?: unknown, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++;
    const timer = setTimeout(() => {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(new Error(`Timed out waiting for Codex response to ${method}.`));
      }
    }, timeoutMs);

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method, timer });
    });

    this.write({ id, method, params });
    return promise;
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: RpcEnvelope;
    try {
      message = JSON.parse(line) as RpcEnvelope;
    } catch {
      this.emit("stderr", `Non-JSON app-server output: ${line}`);
      return;
    }

    const kind = classifyRpcEnvelope(message);

    if (kind === "response") {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) {
        this.emit("notification", { method: "unmatchedResponse", params: message });
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (kind === "serverRequest" && message.method !== undefined && message.id !== undefined) {
      const record: ServerRequestRecord = {
        id: message.id,
        method: message.method,
        params: message.params,
        receivedAt: new Date().toISOString()
      };
      this.serverRequests.set(message.id, record);
      this.emit("serverRequest", record);
      return;
    }

    this.emit("notification", message);
  }

  private write(message: RpcEnvelope): void {
    if (!this.proc?.stdin.writable) {
      throw new Error("Codex app-server is not running.");
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
