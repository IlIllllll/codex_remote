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

export interface DirectoryEntry {
  name: string;
  path: string;
  relativePath: string;
}

export interface DirectoryListResponse {
  rootPath: string;
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
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
  userMessage?: unknown;
  prompt?: unknown;
  input?: unknown;
  message?: unknown;
  request?: unknown;
  submission?: unknown;
  [key: string]: unknown;
}

export type ThreadItem = {
  type: string;
  id: string;
  role?: string;
  text?: string;
  message?: unknown;
  input?: unknown;
  prompt?: unknown;
  output?: unknown;
  value?: unknown;
  content?: unknown;
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
  [key: string]: unknown;
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

export interface LiveAgentMessage {
  itemId: string;
  threadId: string | null;
  turnId: string | null;
  text: string;
  completed: boolean;
  updatedAt: string;
}

export interface LiveTurnState {
  threadId: string | null;
  turnId: string | null;
  status: "running" | "completed";
  startedAt: string;
  updatedAt: string;
}

export interface LiveStateSnapshot {
  threadId: string | null;
  agentMessages: LiveAgentMessage[];
  activeTurns: LiveTurnState[];
  updatedAt: string | null;
}

export interface ProjectFile {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  mime: string;
  rawUrl: string;
}

export interface ProjectFilePreview extends ProjectFile {
  line: number | null;
  kind: "markdown" | "text" | "image" | "pdf" | "binary";
  truncated: boolean;
  content?: string;
}
