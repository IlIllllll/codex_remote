import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bot,
  FileText,
  FolderOpen,
  GitBranch,
  MessageSquare,
  RefreshCcw,
  Send,
  Settings2,
  Trash2,
  Upload,
  X
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  createProject,
  createUser,
  deleteProject,
  deleteUser,
  getApiUserId,
  fetchProjectFileBlob,
  listProjects,
  listThreads,
  listUsers,
  previewProjectFile,
  readThread,
  selectDirectory,
  setApiUserId,
  uploadProjectFiles
} from "./api";
import { codexSocket } from "./codexSocket";
import type {
  ApprovalPolicy,
  CodexNotification,
  Project,
  ProjectFile,
  ProjectFilePreview,
  ReasoningEffort,
  SandboxMode,
  SocketMessage,
  ThreadItem,
  ThreadSummary,
  Turn,
  UserProfile
} from "./types";

function safeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusText(status: unknown): string {
  if (!status) {
    return "ready";
  }
  if (typeof status === "string") {
    return status;
  }
  if (typeof status === "object" && "type" in status) {
    return safeText((status as { type?: unknown }).type);
  }
  return safeText(status);
}

function textFromStructuredValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textFromStructuredValue).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["text", "message", "prompt", "input", "value", "content", "markdown", "body"]) {
      const text = textFromStructuredValue(object[key]);
      if (text.trim()) {
        return text;
      }
    }
    if (typeof object.path === "string") {
      return object.path;
    }
    if (typeof object.url === "string") {
      return object.url;
    }
  }
  return "";
}

function itemText(item: ThreadItem): string {
  const text = textFromStructuredValue(item.text ?? item.message ?? item.content ?? item.input ?? item.prompt ?? item.value ?? item.output);
  if (text.trim()) {
    return text;
  }
  if (item.command) {
    return safeText(item.command);
  }
  if (item.summary?.length) {
    return item.summary.map(safeText).join("\n");
  }
  return "";
}

type MessageKind = "user" | "agent" | "tool" | "system";

function normalizedToken(value: unknown): string {
  return safeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function itemKind(item: ThreadItem): MessageKind {
  const token = `${normalizedToken(item.role)} ${normalizedToken(item.type)} ${normalizedToken(item.tool)}`;
  if (token.includes("user")) {
    return "user";
  }
  if (token.includes("assistant") || token.includes("agent")) {
    return "agent";
  }
  if (token.includes("tool") || token.includes("command") || item.command || item.aggregatedOutput) {
    return "tool";
  }
  return "system";
}

function itemLabel(item: ThreadItem): string {
  const type = safeText(item.type);
  if (itemKind(item) === "user") {
    return type ? `用户 · ${type}` : "用户";
  }
  if (itemKind(item) === "agent") {
    return type ? `Codex · ${type}` : "Codex";
  }
  if (itemKind(item) === "tool") {
    return item.tool ? `工具 · ${item.tool}` : type || "工具";
  }
  return type || "系统";
}

function messageClassName(item: ThreadItem, extraClass = ""): string {
  const typeClass = `type-${safeText(item.type || "message").replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  return ["messageItem", `kind-${itemKind(item)}`, typeClass, extraClass].filter(Boolean).join(" ");
}

function turnUserText(turn: Turn): string {
  for (const value of [turn.userMessage, turn.prompt, turn.input, turn.message, turn.request, turn.submission]) {
    const text = textFromStructuredValue(value);
    if (text.trim()) {
      return text;
    }
  }
  return "";
}

function turnHasUserItem(turn: Turn): boolean {
  return (turn.items ?? []).some((item) => itemKind(item) === "user" && itemText(item).trim());
}

function threadHasUserText(thread: ThreadSummary, text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return true;
  }
  return (thread.turns ?? []).some((turn) =>
    (turn.items ?? []).some((item) => itemKind(item) === "user" && itemText(item).trim() === normalized)
  );
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

function projectNameFromPath(rootPath: string): string {
  return rootPath.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) ?? "Project";
}

type ModelProfile = {
  id: string;
  label: string;
  model: string;
  effort: ReasoningEffort;
};

const modelProfiles: ModelProfile[] = [
  { id: "gpt-5.5:xhigh", label: "GPT-5.5 xhigh", model: "gpt-5.5", effort: "xhigh" },
  { id: "gpt-5.5:high", label: "GPT-5.5 high", model: "gpt-5.5", effort: "high" },
  { id: "gpt-5.5:medium", label: "GPT-5.5 medium", model: "gpt-5.5", effort: "medium" },
  { id: "gpt-5.5:low", label: "GPT-5.5 low", model: "gpt-5.5", effort: "low" }
];

const defaultModelProfileId = "gpt-5.5:xhigh";
const adminUserId = "admin";
const markdownRemarkPlugins = [remarkGfm, remarkBreaks];

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileTargetFromHref(href?: string): string | null {
  if (!href || href.startsWith("#")) {
    return null;
  }

  if (/^file:\/\//i.test(href)) {
    return href;
  }

  if (/^https?:\/\//i.test(href)) {
    if (typeof window === "undefined") {
      return null;
    }
    const parsed = new URL(href, window.location.href);
    if (parsed.origin !== window.location.origin || parsed.pathname.startsWith("/api/")) {
      return null;
    }
    return `${safeDecodeURIComponent(parsed.pathname)}${parsed.hash}`;
  }

  if (href.startsWith("/")) {
    if (href.startsWith("/api/")) {
      return null;
    }
    return safeDecodeURIComponent(href);
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }

  return href;
}

function MarkdownMessage({ text, onOpenFileLink }: { text: string; onOpenFileLink?: (target: string) => void }) {
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ children, href, ...props }) {
        const fileTarget = fileTargetFromHref(href);
        return (
          <a
            href={href}
            rel="noreferrer"
            target={fileTarget ? undefined : "_blank"}
            onClick={(event) => {
              if (!fileTarget || !onOpenFileLink) {
                return;
              }
              event.preventDefault();
              onOpenFileLink(fileTarget);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }
    }),
    [onOpenFileLink]
  );

  return (
    <div className="messageMarkdown">
      <ReactMarkdown components={markdownComponents} remarkPlugins={markdownRemarkPlugins}>
        {text || " "}
      </ReactMarkdown>
    </div>
  );
}

function uploadedFileMarkdown(files: ProjectFile[]): string {
  return files.map((file) => `- [${file.name}](${file.relativePath})`).join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function modelProfileById(id: string): ModelProfile {
  return modelProfiles.find((profile) => profile.id === id) ?? modelProfiles[0];
}

function modelProfileIdFor(model: string, effort: ReasoningEffort): string {
  return modelProfiles.find((profile) => profile.model === model && profile.effort === effort)?.id ?? defaultModelProfileId;
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(getApiUserId());
  const [newUserName, setNewUserName] = useState("");
  const [pendingCreateUserName, setPendingCreateUserName] = useState<string | null>(null);
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState("/Volumes/DevDrive/program");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadSummary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [modelProfileId, setModelProfileId] = useState(defaultModelProfileId);
  const [sandbox, setSandbox] = useState<SandboxMode>("danger-full-access");
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("never");
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [liveDeltas, setLiveDeltas] = useState<Record<string, string>>({});
  const [pendingUserMessages, setPendingUserMessages] = useState<
    Array<{ id: string; requestId: string; threadId: string | null; text: string }>
  >([]);
  const [uploadedFiles, setUploadedFiles] = useState<ProjectFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [filePreview, setFilePreview] = useState<ProjectFilePreview | null>(null);
  const [filePreviewObjectUrl, setFilePreviewObjectUrl] = useState<string>("");
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState("");
  const [handledLocationFileTarget, setHandledLocationFileTarget] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const selectedModelProfile = useMemo(() => modelProfileById(modelProfileId), [modelProfileId]);
  const isAdmin = selectedUserId === adminUserId;

  useEffect(() => {
    void refreshUsers();
    void refreshProjects();
    codexSocket.connect();
    const unsubscribe = codexSocket.subscribe(handleSocketMessage);
    const unsubscribeStatus = codexSocket.subscribeStatus(setSocketStatus);
    return () => {
      unsubscribe();
      unsubscribeStatus();
    };
  }, []);

  useEffect(() => {
    setApiUserId(selectedUserId);
    setSelectedProjectId("");
    setSelectedThread(null);
    setThreads([]);
    setLiveDeltas({});
    setPendingUserMessages([]);
    setUploadedFiles([]);
    setFilePreview(null);
    setFilePreviewObjectUrl("");
    setPendingDeleteProjectId(null);
    setPendingDeleteUserId(null);
    void refreshProjects();
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    setLiveDeltas({});
    setPendingUserMessages([]);
    setUploadedFiles([]);
    setFilePreview(null);
    setFilePreviewObjectUrl("");
    setModelProfileId(modelProfileIdFor(selectedProject.defaultModel || "gpt-5.5", selectedProject.defaultReasoningEffort || "xhigh"));
    setSandbox(selectedProject.defaultSandbox || "danger-full-access");
    setApprovalPolicy(selectedProject.defaultApprovalPolicy || "never");
    void refreshThreads(selectedProject.id);
  }, [selectedProjectId]);

  useEffect(() => {
    return () => {
      if (filePreviewObjectUrl) {
        URL.revokeObjectURL(filePreviewObjectUrl);
      }
    };
  }, [filePreviewObjectUrl]);

  async function refreshProjects() {
    try {
      const response = await listProjects();
      setProjects(response.data);
      setProjectRoot(response.projectRoot);
      if (!response.data.some((project) => project.id === selectedProjectId)) {
        setSelectedThread(null);
        setThreads([]);
        setSelectedProjectId("");
      }
      if ((!selectedProjectId || !response.data.some((project) => project.id === selectedProjectId)) && response.data[0]) {
        setSelectedProjectId(response.data[0].id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function refreshUsers() {
    try {
      const response = await listUsers();
      setUsers(response.data);
      if (!response.data.some((user) => user.id === selectedUserId)) {
        const fallback = response.data.find((user) => user.id === response.defaultUserId) ?? response.data[0];
        if (fallback) {
          setSelectedUserId(fallback.id);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function requestAddUser() {
    const name = newUserName.trim();
    if (!name) {
      return;
    }
    setError("");
    setPendingCreateUserName(name);
  }

  async function confirmAddUser() {
    if (!pendingCreateUserName) {
      return;
    }
    try {
      const response = await createUser({ name: pendingCreateUserName });
      setUsers((current) => [response.data, ...current]);
      setSelectedUserId(response.data.id);
      setNewUserName("");
      setPendingCreateUserName(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function removeUser(user: UserProfile) {
    try {
      setError("");
      await deleteUser(user.id);
      setPendingDeleteUserId(null);
      setUsers((current) => current.filter((entry) => entry.id !== user.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function requestRemoveUser(user: UserProfile) {
    if (pendingDeleteUserId !== user.id) {
      setPendingDeleteUserId(user.id);
      return;
    }
    void removeUser(user);
  }

  async function refreshThreads(projectId = selectedProjectId) {
    if (!projectId) {
      return;
    }
    try {
      const response = await listThreads(projectId);
      setThreads(response.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function openThread(threadId: string) {
    try {
      const response = await readThread(threadId, selectedProjectId);
      setSelectedThread(response.thread);
      setLiveDeltas({});
      setPendingUserMessages((current) =>
        current.filter((entry) => entry.threadId && entry.threadId !== response.thread.id ? true : !threadHasUserText(response.thread, entry.text))
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function connectProjectDirectory(rootPath: string) {
    const existingProject = projects.find((project) => project.rootPath === rootPath);
    if (existingProject) {
      setPendingDeleteProjectId(null);
      setSelectedThread(null);
      setThreads([]);
      setSelectedProjectId(existingProject.id);
      return;
    }

    try {
      const response = await createProject({
        name: projectNameFromPath(rootPath),
        rootPath,
        defaultModel: selectedModelProfile.model,
        defaultReasoningEffort: selectedModelProfile.effort,
        defaultSandbox: sandbox,
        defaultApprovalPolicy: approvalPolicy
      });
      setProjects((current) => [response.data, ...current.filter((project) => project.id !== response.data.id)]);
      setPendingDeleteProjectId(null);
      setSelectedProjectId(response.data.id);
      setSelectedThread(null);
      setThreads([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function chooseDirectory() {
    setSelectingDirectory(true);
    setError("");
    try {
      const response = await selectDirectory();
      await connectProjectDirectory(response.data.rootPath);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.includes("canceled")) {
        setError(message);
      }
    } finally {
      setSelectingDirectory(false);
    }
  }

  async function removeProject(project: Project) {
    try {
      setError("");
      await deleteProject(project.id);
      if (selectedProjectId === project.id) {
        setSelectedProjectId("");
        setSelectedThread(null);
        setThreads([]);
      }
      setPendingDeleteProjectId(null);
      setProjects((current) => current.filter((entry) => entry.id !== project.id));
      await refreshProjects();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function requestRemoveProject(project: Project) {
    if (pendingDeleteProjectId !== project.id) {
      setPendingDeleteProjectId(project.id);
      return;
    }
    void removeProject(project);
  }

  async function handleFileUpload(files: FileList | null) {
    if (!selectedProject || !files?.length) {
      return;
    }
    setUploadingFiles(true);
    setError("");
    try {
      const response = await uploadProjectFiles(selectedProject.id, files);
      setUploadedFiles((current) => [...response.data, ...current]);
      const markdown = uploadedFileMarkdown(response.data);
      setPrompt((current) => {
        const prefix = current.trim() ? `${current.trim()}\n\n` : "";
        return `${prefix}上传文件：\n${markdown}`;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function closeFilePreview() {
    setFilePreview(null);
    setFilePreviewError("");
    setFilePreviewLoading(false);
    setFilePreviewObjectUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
  }

  async function openFilePreview(filePath: string) {
    if (!selectedProject) {
      return;
    }
    setFilePreviewLoading(true);
    setFilePreviewError("");
    setFilePreview(null);
    setFilePreviewObjectUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
    try {
      const response = await previewProjectFile(selectedProject.id, filePath);
      setFilePreview(response.data);
      if (response.data.kind === "image" || response.data.kind === "pdf") {
        const blob = await fetchProjectFileBlob(selectedProject.id, response.data.relativePath);
        setFilePreviewObjectUrl(URL.createObjectURL(blob));
      }
    } catch (caught) {
      setFilePreviewError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFilePreviewLoading(false);
    }
  }

  useEffect(() => {
    if (handledLocationFileTarget || !selectedProject || typeof window === "undefined") {
      return;
    }
    const target = fileTargetFromHref(window.location.href);
    if (!target || !target.startsWith(selectedProject.rootPath)) {
      return;
    }
    setHandledLocationFileTarget(true);
    window.history.replaceState(null, "", "/");
    void openFilePreview(target);
  }, [handledLocationFileTarget, selectedProjectId]);

  function sendPrompt() {
    const promptText = prompt.trim();
    if (!selectedProject || !promptText) {
      return;
    }
    const requestId = `thread-${crypto.randomUUID()}`;
    const payload = selectedThread
      ? {
          type: "turn.start",
          requestId,
          userId: selectedUserId,
          projectId: selectedProject.id,
          threadId: selectedThread.id,
          prompt: promptText,
          model: selectedModelProfile.model,
          reasoningEffort: selectedModelProfile.effort,
          sandbox,
          approvalPolicy
        }
      : {
          type: "thread.start",
          requestId,
          userId: selectedUserId,
          projectId: selectedProject.id,
          prompt: promptText,
          model: selectedModelProfile.model,
          reasoningEffort: selectedModelProfile.effort,
          sandbox,
          approvalPolicy
    };
    try {
      codexSocket.send(payload);
      setPendingUserMessages((current) => [
        ...current,
        {
          id: `user-${requestId}`,
          requestId,
          threadId: selectedThread?.id ?? null,
          text: promptText
        }
      ]);
      setPrompt("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function handleSocketMessage(message: SocketMessage) {
    if (message.type === "ack") {
      if (!message.ok) {
        setError(message.error ?? "Socket request failed.");
        return;
      }
      const data = message.data as { thread?: { thread?: ThreadSummary }; turn?: { turn?: { id?: string } } } | undefined;
      const newThread = data?.thread?.thread;
      if (newThread?.id) {
        setSelectedThread(newThread);
        setSelectedThread((current) => (current ? { ...current, turns: current.turns ?? [] } : current));
        if (message.requestId) {
          setPendingUserMessages((current) =>
            current.map((entry) => (entry.requestId === message.requestId ? { ...entry, threadId: newThread.id } : entry))
          );
        }
      }
      if (data?.turn?.turn?.id) {
        setActiveTurnId(data.turn.turn.id);
      }
      window.setTimeout(() => void refreshThreads(), 750);
      return;
    }

    if (message.type === "codex.notification") {
      const notification = message.data as CodexNotification;
      const params = notification.params ?? {};
      if (notification.method === "item/agentMessage/delta") {
        const itemId = String(params.itemId ?? "");
        const delta = String(params.delta ?? "");
        setLiveDeltas((current) => ({ ...current, [itemId]: `${current[itemId] ?? ""}${delta}` }));
      }
      if (notification.method === "turn/started") {
        const turn = params.turn as { id?: string } | undefined;
        setActiveTurnId(turn?.id ?? null);
        const threadId = String(params.threadId ?? "");
        if (threadId && (!selectedThread || selectedThread.id !== threadId)) {
          void openThread(threadId);
        }
      }
      if (notification.method === "turn/completed") {
        setActiveTurnId(null);
        if (selectedThread?.id) {
          void openThread(selectedThread.id);
        }
        void refreshThreads();
      }
      return;
    }
  }

  const allLiveMessages = Object.entries(liveDeltas).map(([id, text]) => ({ id, text }));
  const visiblePendingUserMessages = pendingUserMessages.filter((entry) => {
    if (!selectedThread?.id) {
      return entry.threadId === null;
    }
    return entry.threadId === null || entry.threadId === selectedThread.id;
  });

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <Bot size={22} />
          <div>
            <strong>Codex Web</strong>
            <span className={`statusDot ${socketStatus}`}>{socketStatus}</span>
          </div>
        </div>

        <div className="userSwitcher">
          <div className="miniHeader">
            <span>用户</span>
          </div>
          <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.id === adminUserId ? `${user.name} (管理员)` : user.name}
              </option>
            ))}
          </select>
          <div className="userCreateRow">
            <input
              value={newUserName}
              onChange={(event) => setNewUserName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  requestAddUser();
                }
              }}
              placeholder="新用户名称"
            />
            <button className="iconTextButton" type="button" onClick={requestAddUser}>
              添加
            </button>
          </div>
          {isAdmin ? (
            <div className="userAdminList">
              <div className="miniHeader">
                <span>用户管理</span>
              </div>
              {users.filter((user) => user.id !== adminUserId).length ? (
                users
                  .filter((user) => user.id !== adminUserId)
                  .map((user) => {
                    const deletePending = pendingDeleteUserId === user.id;
                    return (
                      <div className="userAdminRow" key={user.id}>
                        <span>{user.name}</span>
                        <button
                          className={`miniDangerButton ${deletePending ? "confirm" : ""}`}
                          type="button"
                          onClick={() => requestRemoveUser(user)}
                          title={deletePending ? `确认删除 ${user.name}` : `删除 ${user.name}`}
                        >
                          {deletePending ? "确认" : "删除"}
                        </button>
                      </div>
                    );
                  })
              ) : (
                <p className="creatorHint">暂无其他用户。</p>
              )}
            </div>
          ) : null}
          <p className="creatorHint">只控制项目目录记忆和可见项目，不隔离 Codex 登录态。</p>
        </div>

        <div className="projectCreator">
          <div className="miniHeader">
            <FolderOpen size={16} />
            <span>连接本地记录</span>
          </div>
          <button
            className="iconTextButton primary full"
            type="button"
            onClick={() => void chooseDirectory()}
            disabled={selectingDirectory}
          >
            <FolderOpen size={16} />
            {selectingDirectory ? "选择中" : "选择目录"}
          </button>
          <p className="creatorHint">选择后会自动连接该目录的 Codex 记录，并用目录名作为项目名。</p>
        </div>

        <div className="listHeader">
          <span>本地项目</span>
          <button className="iconButton" type="button" onClick={() => void refreshProjects()} title="Refresh projects">
            <RefreshCcw size={15} />
          </button>
        </div>
        <div className="projectList">
          {projects.map((project) => {
            const deletePending = pendingDeleteProjectId === project.id;
            return (
              <div
                className={`projectRow ${project.id === selectedProjectId ? "selected" : ""}`}
                key={project.id}
              >
                <button
                  className="projectSelectButton"
                  type="button"
                  onClick={() => {
                    setPendingDeleteProjectId(null);
                    setSelectedProjectId(project.id);
                  }}
                >
                  <GitBranch size={15} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.rootPath}</small>
                  </span>
                </button>
                <button
                  className={`projectDeleteButton ${deletePending ? "confirm" : ""}`}
                  type="button"
                  onClick={() => requestRemoveProject(project)}
                  title={deletePending ? `确认移除 ${project.name}` : `移除 ${project.name}`}
                >
                  {deletePending ? "确认" : <Trash2 size={15} />}
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {pendingCreateUserName ? (
        <div className="modalScrim" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
          <div className="confirmDialog">
            <h2 id="create-user-title">确认添加用户</h2>
            <p>将创建用户 “{pendingCreateUserName}”，用于记忆该用户可见的本地项目目录。</p>
            <div className="dialogActions">
              <button className="iconTextButton" type="button" onClick={() => setPendingCreateUserName(null)}>
                取消
              </button>
              <button className="iconTextButton primary" type="button" onClick={() => void confirmAddUser()}>
                确认添加
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="threadColumn">
        <header className="topbar">
          <div className="projectTitle">
            <h1>{selectedProject?.name ?? "No Project"}</h1>
            <p>{selectedProject?.rootPath ?? projectRoot}</p>
            {selectedProject ? <span className="recordMapping">记录来源：cwd 匹配该目录的 Codex threads</span> : null}
          </div>
          <div className="controls">
            <Settings2 size={17} />
            <select value={modelProfileId} onChange={(event) => setModelProfileId(event.target.value)}>
              {modelProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
            <select value={sandbox} onChange={(event) => setSandbox(event.target.value as SandboxMode)}>
              <option value="danger-full-access">完全访问</option>
              <option value="workspace-write">项目可写</option>
              <option value="read-only">只读</option>
            </select>
            <select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as ApprovalPolicy)}>
              <option value="never">不询问</option>
              <option value="on-request">需要时询问</option>
              <option value="untrusted">不可信命令询问</option>
            </select>
          </div>
        </header>

        {error ? (
          <div className="errorBanner" onClick={() => setError("")}>
            {error}
          </div>
        ) : null}

        <div className="workspace">
          <nav className="threadList">
            <div className="listHeader">
              <span>Codex 记录</span>
              <button className="iconButton" type="button" onClick={() => void refreshThreads()} title="Refresh threads">
                <RefreshCcw size={15} />
              </button>
            </div>
            <button type="button" className="newThreadButton" onClick={() => setSelectedThread(null)}>
              <MessageSquare size={15} />
              新建会话
            </button>
            {threads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                className={`threadRow ${selectedThread?.id === thread.id ? "selected" : ""}`}
                onClick={() => void openThread(thread.id)}
              >
                <Archive size={14} />
                <span>
                  <strong>{thread.name || thread.preview || "Untitled"}</strong>
                  <small>{formatTime(thread.updatedAt)}</small>
                </span>
              </button>
            ))}
          </nav>

          <section className="conversation">
            <div className="conversationHeader">
              <h2>{selectedThread?.name || selectedThread?.preview || "New Thread"}</h2>
              <span>{activeTurnId ? "running" : statusText(selectedThread?.status)}</span>
            </div>
            <div className="messages">
              {(selectedThread?.turns ?? []).flatMap((turn) => {
                const syntheticUserText = turnHasUserItem(turn) ? "" : turnUserText(turn);
                const syntheticUserItem: ThreadItem | null = syntheticUserText.trim()
                  ? {
                      id: `${turn.id}-user-input`,
                      type: "userMessage",
                      role: "user",
                      text: syntheticUserText
                    }
                  : null;
                const items = syntheticUserItem ? [syntheticUserItem, ...(turn.items ?? [])] : turn.items ?? [];
                return items.map((item) => (
                  <article className={messageClassName(item)} key={`${turn.id}-${item.id}`}>
                    <div className="messageMeta">{itemLabel(item)}</div>
                    {item.command ? (
                      <pre>{safeText(item.command)}</pre>
                    ) : (
                      <MarkdownMessage text={itemText(item)} onOpenFileLink={(target) => void openFilePreview(target)} />
                    )}
                    {item.aggregatedOutput ? <pre className="outputBlock">{safeText(item.aggregatedOutput)}</pre> : null}
                  </article>
                ));
              })}
              {visiblePendingUserMessages.map((entry) => {
                const item: ThreadItem = {
                  id: entry.id,
                  type: "userMessage",
                  role: "user",
                  text: entry.text
                };
                return (
                  <article className={messageClassName(item, "live pending")} key={entry.id}>
                    <div className="messageMeta">用户 · sending</div>
                    <MarkdownMessage text={entry.text} onOpenFileLink={(target) => void openFilePreview(target)} />
                  </article>
                );
              })}
              {allLiveMessages.map((entry) => (
                <article className="messageItem kind-agent type-agentMessage live" key={entry.id}>
                  <div className="messageMeta">Codex · agentMessage</div>
                  <MarkdownMessage text={entry.text} onOpenFileLink={(target) => void openFilePreview(target)} />
                </article>
              ))}
              {!selectedThread && allLiveMessages.length === 0 && visiblePendingUserMessages.length === 0 ? (
                <div className="emptyState">Ready for a new Codex turn.</div>
              ) : null}
            </div>
            <div className="composer">
              <div className="composerBody">
                <div className="composerTools">
                  <input
                    ref={fileInputRef}
                    className="hiddenFileInput"
                    multiple
                    type="file"
                    onChange={(event) => void handleFileUpload(event.target.files)}
                  />
                  <button
                    className="iconTextButton"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!selectedProject || uploadingFiles}
                  >
                    <Upload size={15} />
                    {uploadingFiles ? "上传中" : "上传文件"}
                  </button>
                  {uploadedFiles.length ? <span className="uploadCount">{uploadedFiles.length} 个文件</span> : null}
                </div>
                {uploadedFiles.length ? (
                  <div className="uploadedFileList">
                    {uploadedFiles.slice(0, 6).map((file) => (
                      <button
                        className="uploadedFileChip"
                        key={file.relativePath}
                        type="button"
                        onClick={() => void openFilePreview(file.relativePath)}
                        title={file.relativePath}
                      >
                        <FileText size={14} />
                        <span>{file.name}</span>
                        <small>{formatBytes(file.size)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      sendPrompt();
                    }
                  }}
                  placeholder="Ask Codex to work in this project"
                />
              </div>
              <button className="iconButton primary sendButton" type="button" onClick={sendPrompt} disabled={!selectedProject || !prompt.trim()}>
                <Send size={18} />
              </button>
            </div>
          </section>
        </div>
      </section>

      {filePreview || filePreviewLoading || filePreviewError ? (
        <div className="modalScrim filePreviewScrim" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
          <section className="filePreviewDialog">
            <header className="filePreviewHeader">
              <div>
                <h2 id="file-preview-title">{filePreview?.name ?? "文件预览"}</h2>
                <p>
                  {filePreview?.relativePath ?? filePreviewError}
                  {filePreview?.line ? <span>:{filePreview.line}</span> : null}
                </p>
              </div>
              <button className="iconButton" type="button" onClick={closeFilePreview} title="Close preview">
                <X size={17} />
              </button>
            </header>
            <div className="filePreviewBody">
              {filePreviewLoading ? <div className="emptyState">Loading file preview.</div> : null}
              {!filePreviewLoading && filePreviewError ? <div className="filePreviewError">{filePreviewError}</div> : null}
              {!filePreviewLoading && filePreview ? (
                <>
                  {filePreview.kind === "markdown" ? (
                    <div className="fileMarkdownPreview">
                      <MarkdownMessage text={filePreview.content ?? ""} onOpenFileLink={(target) => void openFilePreview(target)} />
                    </div>
                  ) : null}
                  {filePreview.kind === "text" ? <pre className="fileTextPreview">{filePreview.content ?? ""}</pre> : null}
                  {filePreview.kind === "image" && filePreviewObjectUrl ? (
                    <img className="fileImagePreview" src={filePreviewObjectUrl} alt={filePreview.name} />
                  ) : null}
                  {filePreview.kind === "pdf" && filePreviewObjectUrl ? (
                    <iframe className="filePdfPreview" src={filePreviewObjectUrl} title={filePreview.name} />
                  ) : null}
                  {filePreview.kind === "binary" ? (
                    <div className="fileBinaryPreview">
                      <FileText size={28} />
                      <strong>{filePreview.mime}</strong>
                      <span>{formatBytes(filePreview.size)}</span>
                    </div>
                  ) : null}
                  {filePreview.truncated ? <p className="previewHint">Preview truncated at 2 MB.</p> : null}
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
