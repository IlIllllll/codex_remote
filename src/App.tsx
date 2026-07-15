import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronUp,
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
  listDirectories,
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
import { fileTargetFromHref } from "./fileLinks";
import { notificationMatchesThread, notificationThreadId } from "./threadNotifications";
import { userMessageNeedsCollapse, userMessagePreview } from "./userMessages";
import type {
  ApprovalPolicy,
  CodexNotification,
  DirectoryListResponse,
  LiveStateSnapshot,
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
  { id: "gpt-5.6-sol:xhigh", label: "GPT-5.6 Sol xhigh", model: "gpt-5.6-sol", effort: "xhigh" },
  { id: "gpt-5.6-sol:high", label: "GPT-5.6 Sol high", model: "gpt-5.6-sol", effort: "high" },
  { id: "gpt-5.6-sol:medium", label: "GPT-5.6 Sol medium", model: "gpt-5.6-sol", effort: "medium" },
  { id: "gpt-5.6-sol:low", label: "GPT-5.6 Sol low", model: "gpt-5.6-sol", effort: "low" },
  { id: "gpt-5.6-terra:xhigh", label: "GPT-5.6 Terra xhigh", model: "gpt-5.6-terra", effort: "xhigh" },
  { id: "gpt-5.6-terra:high", label: "GPT-5.6 Terra high", model: "gpt-5.6-terra", effort: "high" },
  { id: "gpt-5.6-terra:medium", label: "GPT-5.6 Terra medium", model: "gpt-5.6-terra", effort: "medium" },
  { id: "gpt-5.6-terra:low", label: "GPT-5.6 Terra low", model: "gpt-5.6-terra", effort: "low" },
  { id: "gpt-5.6-luna:xhigh", label: "GPT-5.6 Luna xhigh", model: "gpt-5.6-luna", effort: "xhigh" },
  { id: "gpt-5.6-luna:high", label: "GPT-5.6 Luna high", model: "gpt-5.6-luna", effort: "high" },
  { id: "gpt-5.6-luna:medium", label: "GPT-5.6 Luna medium", model: "gpt-5.6-luna", effort: "medium" },
  { id: "gpt-5.6-luna:low", label: "GPT-5.6 Luna low", model: "gpt-5.6-luna", effort: "low" }
];

const defaultModelProfileId = "gpt-5.6-sol:xhigh";
const adminUserId = "admin";
const markdownRemarkPlugins = [remarkGfm, remarkBreaks];

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

function ThreadMessageArticle({
  item,
  className,
  label,
  onOpenFileLink
}: {
  item: ThreadItem;
  className: string;
  label: string;
  onOpenFileLink?: (target: string) => void;
}) {
  const text = itemText(item);
  const collapsible = itemKind(item) === "user" && userMessageNeedsCollapse(text);
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsible && !expanded;

  return (
    <article className={`${className}${collapsed ? " collapsed" : ""}`}>
      <div className="messageItemHeader">
        <div className="messageMeta">{label}</div>
        {collapsible ? (
          <button
            className="userMessageToggle"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "收起用户消息" : "展开用户消息"}
            title={expanded ? "收起用户消息" : "展开用户消息"}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        ) : null}
      </div>
      {collapsed ? (
        <div className="userMessagePreview" title={userMessagePreview(text)}>
          {userMessagePreview(text)}
        </div>
      ) : item.command ? (
        <pre>{safeText(item.command)}</pre>
      ) : (
        <MarkdownMessage text={text} onOpenFileLink={onOpenFileLink} />
      )}
      {!collapsed && item.aggregatedOutput ? <pre className="outputBlock">{safeText(item.aggregatedOutput)}</pre> : null}
    </article>
  );
}

function uploadedFileMarkdown(files: ProjectFile[]): string {
  return files.map((file) => `- [${file.name}](${file.relativePath})`).join("\n");
}

function promptWithUploadedFiles(promptText: string, files: ProjectFile[]): string {
  if (!files.length) {
    return promptText;
  }
  const uploadContext = `上传文件：\n${uploadedFileMarkdown(files)}`;
  return promptText ? `${promptText}\n\n${uploadContext}` : uploadContext;
}

function visiblePromptText(promptText: string, files: ProjectFile[]): string {
  if (promptText) {
    return promptText;
  }
  if (!files.length) {
    return "";
  }
  const names = files.map((file) => file.name).join("、");
  return `上传了 ${files.length} 个文件：${names}`;
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

function liveDeltasFromSnapshot(snapshot: LiveStateSnapshot): Record<string, string> {
  return Object.fromEntries(
    snapshot.agentMessages.filter((message) => message.itemId && message.text).map((message) => [message.itemId, message.text])
  );
}

function activeTurnIdFromSnapshot(snapshot: LiveStateSnapshot): string | null {
  return snapshot.activeTurns.find((turn) => turn.status === "running")?.turnId ?? null;
}

function isRunningStatus(status: unknown): boolean {
  const token = normalizedToken(status);
  return token.includes("running") || token.includes("inprogress") || token.includes("active");
}

function requestToken(): string {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
  const [systemDirectoryPickerAvailable, setSystemDirectoryPickerAvailable] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadSummary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false);
  const [directoryBrowser, setDirectoryBrowser] = useState<DirectoryListResponse | null>(null);
  const [directoryBrowserLoading, setDirectoryBrowserLoading] = useState(false);
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
  const selectedUserIdRef = useRef(selectedUserId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const selectedThreadRef = useRef<ThreadSummary | null>(selectedThread);
  const liveThreadIdRef = useRef<string | null>(null);
  const pendingThreadStartRef = useRef(false);
  const threadLoadRequestRef = useRef(0);

  useEffect(() => {
    selectedUserIdRef.current = selectedUserId;
  }, [selectedUserId]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    selectedThreadRef.current = selectedThread;
  }, [selectedThread]);

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
    codexSocket.clearScope();
    liveThreadIdRef.current = null;
    pendingThreadStartRef.current = false;
    threadLoadRequestRef.current += 1;
    setSelectedProjectId("");
    setSelectedThread(null);
    selectedThreadRef.current = null;
    setThreads([]);
    setLiveDeltas({});
    setActiveTurnId(null);
    setPendingUserMessages([]);
    setUploadedFiles([]);
    setFilePreview(null);
    setFilePreviewObjectUrl("");
    setDirectoryBrowserOpen(false);
    setPendingDeleteProjectId(null);
    setPendingDeleteUserId(null);
    void refreshProjects();
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    selectedThreadRef.current = null;
    setSelectedThread(null);
    pendingThreadStartRef.current = false;
    threadLoadRequestRef.current += 1;
    scopeConversation(null, selectedProject.id);
    setPendingUserMessages([]);
    setUploadedFiles([]);
    setFilePreview(null);
    setFilePreviewObjectUrl("");
    setModelProfileId(
      modelProfileIdFor(selectedProject.defaultModel || "gpt-5.6-sol", selectedProject.defaultReasoningEffort || "xhigh")
    );
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
      setSystemDirectoryPickerAvailable(Boolean(response.systemDirectoryPickerAvailable));
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

  async function refreshThreads(projectId = selectedProjectIdRef.current) {
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

  function scopeConversation(threadId: string | null, projectId = selectedProjectIdRef.current, clearLive = true) {
    liveThreadIdRef.current = threadId;
    if (clearLive) {
      setLiveDeltas({});
      setActiveTurnId(null);
    }
    if (!projectId) {
      codexSocket.clearScope();
      return;
    }
    codexSocket.setScope({ userId: selectedUserIdRef.current, projectId, threadId });
  }

  function showNewThread(projectId = selectedProjectIdRef.current) {
    threadLoadRequestRef.current += 1;
    pendingThreadStartRef.current = false;
    selectedThreadRef.current = null;
    setSelectedThread(null);
    setPendingUserMessages([]);
    scopeConversation(null, projectId);
  }

  async function openThread(threadId: string, projectId = selectedProjectIdRef.current) {
    if (!projectId) {
      return;
    }
    const requestNumber = ++threadLoadRequestRef.current;
    try {
      const response = await readThread(threadId, projectId);
      if (requestNumber !== threadLoadRequestRef.current || projectId !== selectedProjectIdRef.current) {
        return;
      }
      selectedThreadRef.current = response.thread;
      setSelectedThread(response.thread);
      pendingThreadStartRef.current = false;
      scopeConversation(response.thread.id, projectId);
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
      showNewThread(existingProject.id);
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
      showNewThread(response.data.id);
      setThreads([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function openDirectoryBrowser(directoryPath?: string) {
    setDirectoryBrowserLoading(true);
    setError("");
    try {
      const response = await listDirectories(directoryPath);
      setDirectoryBrowser(response.data);
      setDirectoryBrowserOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDirectoryBrowserLoading(false);
    }
  }

  async function connectCurrentDirectory() {
    if (!directoryBrowser) {
      return;
    }
    await connectProjectDirectory(directoryBrowser.currentPath);
    setDirectoryBrowserOpen(false);
  }

  async function chooseDirectory() {
    setSelectingDirectory(true);
    setError("");
    try {
      if (!systemDirectoryPickerAvailable) {
        await openDirectoryBrowser(projectRoot);
        return;
      }
      const response = await selectDirectory();
      await connectProjectDirectory(response.data.rootPath);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.includes("system-directory-picker-unavailable")) {
        await openDirectoryBrowser(projectRoot);
        return;
      }
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
        showNewThread("");
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
    if (!selectedProject || (!promptText && !uploadedFiles.length)) {
      return;
    }
    const sentPromptText = promptWithUploadedFiles(promptText, uploadedFiles);
    const visibleText = visiblePromptText(promptText, uploadedFiles);
    const requestId = `thread-${requestToken()}`;
    const payload = selectedThread
      ? {
          type: "turn.start",
          requestId,
          userId: selectedUserId,
          projectId: selectedProject.id,
          threadId: selectedThread.id,
          prompt: sentPromptText,
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
          prompt: sentPromptText,
          model: selectedModelProfile.model,
          reasoningEffort: selectedModelProfile.effort,
          sandbox,
          approvalPolicy
    };
    try {
      pendingThreadStartRef.current = !selectedThread;
      codexSocket.send(payload);
      setPendingUserMessages((current) => [
        ...current,
        {
          id: `user-${requestId}`,
          requestId,
          threadId: selectedThread?.id ?? null,
          text: visibleText
        }
      ]);
      setPrompt("");
      setUploadedFiles([]);
    } catch (caught) {
      pendingThreadStartRef.current = false;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function hydrateLiveState(snapshot: LiveStateSnapshot | undefined) {
    if (!snapshot || (snapshot.threadId ?? null) !== liveThreadIdRef.current) {
      return;
    }
    setLiveDeltas(liveDeltasFromSnapshot(snapshot));
    setActiveTurnId(activeTurnIdFromSnapshot(snapshot));
  }

  function handleSocketMessage(message: SocketMessage) {
    if (message.type === "hello") {
      const data = message.data as { liveState?: LiveStateSnapshot } | undefined;
      hydrateLiveState(data?.liveState);
      return;
    }

    if (message.type === "live.state") {
      hydrateLiveState(message.data as LiveStateSnapshot | undefined);
      return;
    }

    if (message.type === "ack") {
      if (!message.ok) {
        pendingThreadStartRef.current = false;
        setError(message.error ?? "Socket request failed.");
        return;
      }
      const data = message.data as { thread?: { thread?: ThreadSummary }; turn?: { turn?: { id?: string } } } | undefined;
      const newThread = data?.thread?.thread;
      if (newThread?.id) {
        const normalizedThread = { ...newThread, turns: newThread.turns ?? [] };
        pendingThreadStartRef.current = false;
        selectedThreadRef.current = normalizedThread;
        setSelectedThread(normalizedThread);
        scopeConversation(newThread.id, selectedProjectIdRef.current, false);
        if (message.requestId) {
          setPendingUserMessages((current) =>
            current.map((entry) => (entry.requestId === message.requestId ? { ...entry, threadId: newThread.id } : entry))
          );
        }
      }
      if (data?.turn?.turn?.id) {
        setActiveTurnId(data.turn.turn.id);
      }
      window.setTimeout(() => void refreshThreads(selectedProjectIdRef.current), 750);
      return;
    }

    if (message.type === "codex.notification") {
      const notification = message.data as CodexNotification;
      const params = notification.params ?? {};
      const incomingThreadId = notificationThreadId(params);
      if (incomingThreadId && !liveThreadIdRef.current && pendingThreadStartRef.current) {
        scopeConversation(incomingThreadId, selectedProjectIdRef.current, false);
      }
      if (notification.method === "item/agentMessage/delta") {
        if (!notificationMatchesThread(params, liveThreadIdRef.current)) {
          return;
        }
        const itemId = String(params.itemId ?? "");
        const delta = String(params.delta ?? "");
        if (!itemId) {
          return;
        }
        setLiveDeltas((current) => ({ ...current, [itemId]: `${current[itemId] ?? ""}${delta}` }));
      }
      if (notification.method === "turn/started") {
        if (!notificationMatchesThread(params, liveThreadIdRef.current)) {
          return;
        }
        const turn = params.turn as { id?: string } | undefined;
        setActiveTurnId(turn?.id ?? null);
      }
      if (notification.method === "turn/completed") {
        if (!incomingThreadId || !notificationMatchesThread(params, liveThreadIdRef.current)) {
          return;
        }
        pendingThreadStartRef.current = false;
        setActiveTurnId(null);
        setLiveDeltas({});
        const currentThread = selectedThreadRef.current;
        if (!currentThread || currentThread.id === incomingThreadId) {
          void openThread(incomingThreadId, selectedProjectIdRef.current);
        }
        void refreshThreads(selectedProjectIdRef.current);
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
  const conversationRunState = activeTurnId || isRunningStatus(selectedThread?.status) ? "running" : "idle";

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

      {directoryBrowserOpen ? (
        <div className="modalScrim" role="dialog" aria-modal="true" aria-labelledby="directory-browser-title">
          <div className="directoryDialog">
            <div className="directoryDialogHeader">
              <div>
                <h2 id="directory-browser-title">选择项目目录</h2>
                <p>{directoryBrowser?.currentPath ?? projectRoot}</p>
              </div>
              <button className="iconButton" type="button" onClick={() => setDirectoryBrowserOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="directoryToolbar">
              <button
                className="iconTextButton"
                type="button"
                onClick={() => void openDirectoryBrowser(directoryBrowser?.parentPath ?? directoryBrowser?.rootPath)}
                disabled={directoryBrowserLoading || !directoryBrowser?.parentPath}
              >
                上级
              </button>
              <button
                className="iconButton"
                type="button"
                onClick={() => void openDirectoryBrowser(directoryBrowser?.currentPath)}
                disabled={directoryBrowserLoading}
                title="刷新"
              >
                <RefreshCcw size={15} />
              </button>
            </div>
            <div className="directoryList">
              {directoryBrowserLoading ? <div className="directoryEmpty">加载中</div> : null}
              {!directoryBrowserLoading && directoryBrowser?.directories.length === 0 ? (
                <div className="directoryEmpty">没有可进入的子目录</div>
              ) : null}
              {directoryBrowser?.directories.map((entry) => (
                <button
                  className="directoryRow"
                  type="button"
                  key={entry.path}
                  onClick={() => void openDirectoryBrowser(entry.path)}
                  disabled={directoryBrowserLoading}
                >
                  <FolderOpen size={16} />
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{entry.path}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="dialogActions">
              <button className="iconTextButton" type="button" onClick={() => setDirectoryBrowserOpen(false)}>
                取消
              </button>
              <button
                className="iconTextButton primary"
                type="button"
                onClick={() => void connectCurrentDirectory()}
                disabled={directoryBrowserLoading || !directoryBrowser}
              >
                连接当前目录
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
            <button type="button" className="newThreadButton" onClick={() => showNewThread()}>
              <MessageSquare size={15} />
              新建会话
            </button>
            {threads.map((thread) => (
              (() => {
                const threadRunning = isRunningStatus(thread.status) || Boolean(activeTurnId && selectedThread?.id === thread.id);
                return (
                  <button
                    type="button"
                    key={thread.id}
                    className={`threadRow ${selectedThread?.id === thread.id ? "selected" : ""} ${threadRunning ? "running" : ""}`}
                    onClick={() => void openThread(thread.id)}
                  >
                    <Archive size={14} />
                    <span>
                      <strong>{thread.name || thread.preview || "Untitled"}</strong>
                      <small>{formatTime(thread.updatedAt)}</small>
                    </span>
                    {threadRunning ? <span className="threadRunningBadge">running</span> : null}
                  </button>
                );
              })()
            ))}
          </nav>

          <section className="conversation">
            <div className="conversationHeader">
              <div className="conversationTitle">
                <h2>{selectedThread?.name || selectedThread?.preview || "New Thread"}</h2>
                <div className={`threadRunState ${conversationRunState}`}>
                  <span>{conversationRunState}</span>
                  <span className="runLamp" />
                </div>
              </div>
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
                  <ThreadMessageArticle
                    className={messageClassName(item)}
                    item={item}
                    key={`${turn.id}-${item.id}`}
                    label={itemLabel(item)}
                    onOpenFileLink={(target) => void openFilePreview(target)}
                  />
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
                  <ThreadMessageArticle
                    className={messageClassName(item, "live pending")}
                    item={item}
                    key={entry.id}
                    label="用户 · sending"
                    onOpenFileLink={(target) => void openFilePreview(target)}
                  />
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
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                      return;
                    }
                    event.preventDefault();
                    sendPrompt();
                  }}
                  placeholder="Ask Codex to work in this project"
                />
              </div>
              <button
                className="iconButton primary sendButton"
                type="button"
                onClick={sendPrompt}
                disabled={!selectedProject || (!prompt.trim() && !uploadedFiles.length)}
              >
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
