import type {
  ApprovalPolicy,
  Project,
  ProjectFile,
  ProjectFilePreview,
  ReasoningEffort,
  SandboxMode,
  ThreadListResponse,
  ThreadReadResponse,
  UserProfile
} from "./types";

const defaultUserId = "admin";

let currentUserId = localStorage.getItem("codex-web-user-id") || defaultUserId;

export function setApiUserId(userId: string): void {
  currentUserId = userId || defaultUserId;
  localStorage.setItem("codex-web-user-id", currentUserId);
}

export function getApiUserId(): string {
  return currentUserId;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("x-codex-web-user-id", currentUserId);
  const isFormData = typeof FormData !== "undefined" && options?.body instanceof FormData;
  if (options?.body !== undefined && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.message ? `${body.error ?? "Request failed"}: ${body.message}` : body.error;
    throw new Error(message ?? `Request failed: ${response.status}`);
  }
  return body as T;
}

export function listUsers(): Promise<{ data: UserProfile[]; defaultUserId: string }> {
  return request("/api/users");
}

export function createUser(input: { name: string }): Promise<{ data: UserProfile }> {
  return request("/api/users", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteUser(id: string): Promise<{ ok: boolean }> {
  return request(`/api/users/${id}`, { method: "DELETE" });
}

export function listProjects(): Promise<{ data: Project[]; projectRoot: string }> {
  return request("/api/projects");
}

export function createProject(input: {
  name: string;
  rootPath: string;
  createDirectory?: boolean;
  gitInit?: boolean;
  defaultModel?: string;
  defaultReasoningEffort?: ReasoningEffort;
  defaultSandbox?: SandboxMode;
  defaultApprovalPolicy?: ApprovalPolicy;
}): Promise<{ data: Project }> {
  return request("/api/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function selectDirectory(): Promise<{ data: { rootPath: string } }> {
  return request("/api/system/select-directory", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function updateProject(id: string, input: Partial<Project>): Promise<{ data: Project }> {
  return request(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteProject(id: string): Promise<{ ok: boolean }> {
  return request(`/api/projects/${id}`, { method: "DELETE" });
}

export function listThreads(projectId: string): Promise<ThreadListResponse> {
  return request(`/api/projects/${projectId}/threads`);
}

export function readThread(threadId: string, projectId?: string): Promise<ThreadReadResponse> {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request(`/api/threads/${threadId}${suffix}`);
}

export function uploadProjectFiles(projectId: string, files: FileList | File[]): Promise<{ data: ProjectFile[] }> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append("files", file);
  }
  return request(`/api/projects/${projectId}/files/upload`, {
    method: "POST",
    body: form
  });
}

export function previewProjectFile(projectId: string, filePath: string): Promise<{ data: ProjectFilePreview }> {
  return request(`/api/projects/${projectId}/files/preview?path=${encodeURIComponent(filePath)}`);
}

export async function fetchProjectFileBlob(projectId: string, filePath: string): Promise<Blob> {
  const headers = new Headers();
  headers.set("x-codex-web-user-id", currentUserId);
  const response = await fetch(`/api/projects/${projectId}/files/raw?path=${encodeURIComponent(filePath)}`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.blob();
}
