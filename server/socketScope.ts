import type { RpcEnvelope } from "./types.js";

export interface SocketClientScope {
  userId: string;
  projectId: string;
  threadId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function notificationThreadId(envelope: RpcEnvelope): string | null {
  const params = asRecord(envelope.params);
  const thread = asRecord(params.thread);
  const turn = asRecord(params.turn);
  return nonEmptyString(params.threadId) ?? nonEmptyString(thread.id) ?? nonEmptyString(turn.threadId);
}

export function scopeMatchesThread(scope: SocketClientScope | undefined, threadId: string): boolean {
  return scope?.threadId === threadId;
}
