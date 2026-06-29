export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-request" | "never";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface UserProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  rootPath: string;
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
  defaultSandbox: SandboxMode;
  defaultApprovalPolicy: ApprovalPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSummary {
  id: string;
  sessionId: string;
  preview: string;
  name: string | null;
  cwd: string;
  updatedAt: number;
  createdAt: number;
  status: unknown;
  turns: Turn[];
}

export interface Turn {
  id: string;
  status: unknown;
  startedAt: number | null;
  completedAt: number | null;
  items: ThreadItem[];
}

export type ThreadItem = {
  type: string;
  id: string;
  text?: string;
  content?: Array<{ type: string; text?: string; path?: string; url?: string }>;
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: unknown[];
  server?: string;
  tool?: string;
  query?: string;
  summary?: string[];
};

export interface ThreadReadResponse {
  thread: ThreadSummary;
}

export interface ThreadListResponse {
  data: ThreadSummary[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface SocketMessage {
  type: string;
  requestId?: string;
  ok?: boolean;
  data?: unknown;
  error?: string;
}

export interface CodexNotification {
  method?: string;
  params?: Record<string, unknown>;
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
  receivedAt: string;
}

export interface TerminalOutputEvent {
  processId?: string;
  stream?: string;
  text: string;
}

export interface ActivityEvent {
  id: string;
  time: string;
  title: string;
  detail?: string;
  tone?: "normal" | "good" | "warn" | "bad";
}
