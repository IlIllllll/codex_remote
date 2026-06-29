import type { Project, ThreadListResponse, ThreadReadResponse, UserProfile } from "./types";

let currentUserId = localStorage.getItem("codex-web-user-id") || "local";

export function setApiUserId(userId: string): void {
  currentUserId = userId || "local";
  localStorage.setItem("codex-web-user-id", currentUserId);
}

export function getApiUserId(): string {
  return currentUserId;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-codex-web-user-id": currentUserId,
      ...options?.headers
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
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

export function listProjects(): Promise<{ data: Project[]; projectRoot: string }> {
  return request("/api/projects");
}

export function createProject(input: {
  name: string;
  rootPath: string;
  createDirectory?: boolean;
  gitInit?: boolean;
  defaultModel?: string;
  defaultSandbox?: string;
  defaultApprovalPolicy?: string;
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
