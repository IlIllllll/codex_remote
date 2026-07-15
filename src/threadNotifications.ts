export function notificationThreadId(params: Record<string, unknown>): string | null {
  const thread = params.thread && typeof params.thread === "object" ? (params.thread as Record<string, unknown>) : {};
  const turn = params.turn && typeof params.turn === "object" ? (params.turn as Record<string, unknown>) : {};
  const candidates = [params.threadId, thread.id, turn.threadId];
  return candidates.find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? null;
}

export function notificationMatchesThread(params: Record<string, unknown>, threadId: string | null): boolean {
  const incomingThreadId = notificationThreadId(params);
  return Boolean(incomingThreadId && threadId && incomingThreadId === threadId);
}
