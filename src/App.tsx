import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bot,
  FolderPlus,
  FolderOpen,
  GitBranch,
  MessageSquare,
  RefreshCcw,
  Send,
  Settings2,
  Trash2
} from "lucide-react";
import {
  createProject,
  createUser,
  deleteProject,
  getApiUserId,
  listProjects,
  listThreads,
  listUsers,
  readThread,
  selectDirectory,
  setApiUserId
} from "./api";
import { codexSocket } from "./codexSocket";
import { ApprovalPanel } from "./components/ApprovalPanel";
import { TerminalPane } from "./components/TerminalPane";
import type {
  ActivityEvent,
  ApprovalPolicy,
  CodexNotification,
  CodexServerRequest,
  Project,
  SandboxMode,
  SocketMessage,
  TerminalOutputEvent,
  ThreadItem,
  ThreadSummary,
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

function itemText(item: ThreadItem): string {
  if (item.text) {
    return safeText(item.text);
  }
  if (item.content?.length) {
    return item.content.map((part) => safeText(part.text ?? part.path ?? part.url ?? "")).join("\n");
  }
  if (item.command) {
    return safeText(item.command);
  }
  if (item.summary?.length) {
    return item.summary.map(safeText).join("\n");
  }
  return "";
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

function notificationTitle(notification: CodexNotification): ActivityEvent {
  const method = notification.method ?? "event";
  const params = notification.params ?? {};
  const item = params.item as ThreadItem | undefined;
  if (method === "item/completed" && item) {
    return {
      id: crypto.randomUUID(),
      time: new Date().toLocaleTimeString(),
      title: `${item.type} completed`,
      detail: itemText(item).slice(0, 180),
      tone: item.type === "commandExecution" && item.exitCode ? "warn" : "normal"
    };
  }
  if (method === "turn/completed") {
    return { id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), title: "Turn completed", tone: "good" };
  }
  if (method === "error") {
    return { id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), title: "Codex error", detail: JSON.stringify(params), tone: "bad" };
  }
  return {
    id: crypto.randomUUID(),
    time: new Date().toLocaleTimeString(),
    title: method,
    detail: JSON.stringify(params).slice(0, 180)
  };
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(getApiUserId());
  const [newUserName, setNewUserName] = useState("");
  const [projectRoot, setProjectRoot] = useState("/Volumes/DevDrive/program");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadSummary | null>(null);
  const [prompt, setPrompt] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("/Volumes/DevDrive/program/");
  const [createDirectory, setCreateDirectory] = useState(false);
  const [gitInit, setGitInit] = useState(false);
  const [manualPathEdit, setManualPathEdit] = useState(false);
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [model, setModel] = useState("");
  const [sandbox, setSandbox] = useState<SandboxMode>("workspace-write");
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("on-request");
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [approvals, setApprovals] = useState<CodexServerRequest[]>([]);
  const [terminalOutputs, setTerminalOutputs] = useState<TerminalOutputEvent[]>([]);
  const [liveDeltas, setLiveDeltas] = useState<Record<string, string>>({});
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

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
    void refreshProjects();
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    setModel(selectedProject.defaultModel);
    setSandbox(selectedProject.defaultSandbox);
    setApprovalPolicy(selectedProject.defaultApprovalPolicy);
    void refreshThreads(selectedProject.id);
  }, [selectedProjectId]);

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

  async function addUser() {
    if (!newUserName.trim()) {
      return;
    }
    try {
      const response = await createUser({ name: newUserName.trim() });
      setUsers((current) => [response.data, ...current]);
      setSelectedUserId(response.data.id);
      setNewUserName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function addProject() {
    try {
      const response = await createProject({
        name: newProjectName || newProjectPath.split("/").filter(Boolean).at(-1) || "Project",
        rootPath: newProjectPath,
        createDirectory,
        gitInit,
        defaultModel: model,
        defaultSandbox: sandbox,
        defaultApprovalPolicy: approvalPolicy
      });
      setProjects((current) => [response.data, ...current]);
      setSelectedProjectId(response.data.id);
      setNewProjectName("");
      setNewProjectPath(`${projectRoot}/`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function chooseDirectory() {
    setSelectingDirectory(true);
    setError("");
    try {
      const response = await selectDirectory();
      setNewProjectPath(response.data.rootPath);
      if (!newProjectName.trim()) {
        setNewProjectName(response.data.rootPath.split("/").filter(Boolean).at(-1) ?? "");
      }
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
    if (!window.confirm(`Remove ${project.name} from Codex Web?`)) {
      return;
    }
    await deleteProject(project.id);
    await refreshProjects();
  }

  function sendPrompt() {
    if (!selectedProject || !prompt.trim()) {
      return;
    }
    if (sandbox === "danger-full-access" && !window.confirm("Run this turn with danger-full-access?")) {
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
          prompt,
          model,
          sandbox,
          approvalPolicy
        }
      : {
          type: "thread.start",
          requestId,
          userId: selectedUserId,
          projectId: selectedProject.id,
          prompt,
          model,
          sandbox,
          approvalPolicy
        };
    try {
      codexSocket.send(payload);
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
      }
      if (data?.turn?.turn?.id) {
        setActiveTurnId(data.turn.turn.id);
      }
      window.setTimeout(() => void refreshThreads(), 750);
      return;
    }

    if (message.type === "codex.serverRequest") {
      const request = message.data as CodexServerRequest;
      setApprovals((current) => [request, ...current.filter((entry) => entry.id !== request.id)]);
      setActivity((current) => [
        { id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), title: request.method, tone: "warn" as const },
        ...current
      ].slice(0, 100));
      return;
    }

    if (message.type === "terminal.output") {
      setTerminalOutputs((current) => [...current, message.data as TerminalOutputEvent]);
      return;
    }

    if (message.type === "codex.notification") {
      const notification = message.data as CodexNotification;
      setActivity((current) => [notificationTitle(notification), ...current].slice(0, 100));
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

    if (message.type === "codex.stderr") {
      setActivity((current) => [
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString(),
          title: "app-server stderr",
          detail: String(message.data),
          tone: "warn" as const
        },
        ...current
      ].slice(0, 100));
    }
  }

  function respondToApproval(request: CodexServerRequest, decision: "accept" | "acceptForSession" | "decline" | "cancel") {
    const result = request.method.includes("commandExecution") || request.method.includes("fileChange")
      ? { decision }
      : { answers: {} };
    codexSocket.send({
      type: "approval.respond",
      codexRequestId: request.id,
      result
    });
    setApprovals((current) => current.filter((entry) => entry.id !== request.id));
  }

  function execCommand(command: string, processId: string) {
    if (!selectedProject) {
      return;
    }
    codexSocket.send({
      type: "command.exec",
      projectId: selectedProject.id,
      processId,
      command: ["/bin/zsh", "-lc", command],
      userId: selectedUserId,
      tty: true,
      sandbox,
      disableTimeout: false
    });
  }

  function writeCommand(processId: string, data: string) {
    codexSocket.send({ type: "command.write", processId, data });
  }

  function terminateCommand(processId: string) {
    codexSocket.send({ type: "command.terminate", processId });
  }

  const allLiveMessages = Object.entries(liveDeltas).map(([id, text]) => ({ id, text }));

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
                {user.name}
              </option>
            ))}
          </select>
          <div className="userCreateRow">
            <input
              value={newUserName}
              onChange={(event) => setNewUserName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void addUser();
                }
              }}
              placeholder="新用户名称"
            />
            <button className="iconTextButton" type="button" onClick={() => void addUser()}>
              添加
            </button>
          </div>
          <p className="creatorHint">只控制项目目录记忆和可见项目，不隔离 Codex 登录态。</p>
        </div>

        <div className="projectCreator">
          <div className="miniHeader">
            <FolderPlus size={16} />
            <span>连接本地记录</span>
          </div>
          <label className="fieldLabel" htmlFor="project-name-input">
            显示名称
          </label>
          <input
            id="project-name-input"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="可选"
          />
          <label className="fieldLabel" htmlFor="project-path-input">
            本地项目目录
          </label>
          <div className="pathPickerRow">
            <input
              id="project-path-input"
              value={newProjectPath}
              onChange={(event) => setNewProjectPath(event.target.value)}
              placeholder={projectRoot}
              readOnly={!manualPathEdit}
            />
            <button
              className="iconTextButton"
              type="button"
              onClick={() => void chooseDirectory()}
              disabled={selectingDirectory}
            >
              <FolderOpen size={16} />
              {selectingDirectory ? "选择中" : "选择目录"}
            </button>
          </div>
          <p className="creatorHint">本地 Codex 记录会按这个目录的 cwd 进行匹配。</p>
          <label>
            <input type="checkbox" checked={manualPathEdit} onChange={(event) => setManualPathEdit(event.target.checked)} />
            手动编辑路径
          </label>
          <details className="advancedOptions">
            <summary>新建项目选项</summary>
            <label>
              <input type="checkbox" checked={createDirectory} onChange={(event) => setCreateDirectory(event.target.checked)} />
              创建缺失目录
            </label>
            <label>
              <input type="checkbox" checked={gitInit} onChange={(event) => setGitInit(event.target.checked)} />
              初始化 Git 仓库
            </label>
          </details>
          <button className="iconTextButton primary full" type="button" onClick={addProject}>
            <FolderPlus size={16} />
            连接记录
          </button>
        </div>

        <div className="listHeader">
          <span>本地项目</span>
          <button className="iconButton" type="button" onClick={() => void refreshProjects()} title="Refresh projects">
            <RefreshCcw size={15} />
          </button>
        </div>
        <div className="projectList">
          {projects.map((project) => (
            <button
              type="button"
              className={`projectRow ${project.id === selectedProjectId ? "selected" : ""}`}
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
            >
              <GitBranch size={15} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.rootPath}</small>
              </span>
              <Trash2
                size={15}
                onClick={(event) => {
                  event.stopPropagation();
                  void removeProject(project);
                }}
              />
            </button>
          ))}
        </div>
      </aside>

      <section className="threadColumn">
        <header className="topbar">
          <div className="projectTitle">
            <h1>{selectedProject?.name ?? "No Project"}</h1>
            <p>{selectedProject?.rootPath ?? projectRoot}</p>
            {selectedProject ? <span className="recordMapping">记录来源：cwd 匹配该目录的 Codex threads</span> : null}
          </div>
          <div className="controls">
            <Settings2 size={17} />
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="default model" />
            <select value={sandbox} onChange={(event) => setSandbox(event.target.value as SandboxMode)}>
              <option value="workspace-write">workspace-write</option>
              <option value="read-only">read-only</option>
              <option value="danger-full-access">danger-full-access</option>
            </select>
            <select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as ApprovalPolicy)}>
              <option value="on-request">on-request</option>
              <option value="untrusted">untrusted</option>
              <option value="never">never</option>
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
              {(selectedThread?.turns ?? []).flatMap((turn) =>
                (turn.items ?? []).map((item) => (
                  <article className={`messageItem ${item.type}`} key={`${turn.id}-${item.id}`}>
                    <div className="messageMeta">{safeText(item.type)}</div>
                    {item.command ? <pre>{safeText(item.command)}</pre> : <p>{itemText(item)}</p>}
                    {item.aggregatedOutput ? <pre className="outputBlock">{safeText(item.aggregatedOutput)}</pre> : null}
                  </article>
                ))
              )}
              {allLiveMessages.map((entry) => (
                <article className="messageItem agentMessage live" key={entry.id}>
                  <div className="messageMeta">agentMessage</div>
                  <p>{entry.text}</p>
                </article>
              ))}
              {!selectedThread && allLiveMessages.length === 0 ? <div className="emptyState">Ready for a new Codex turn.</div> : null}
            </div>
            <div className="composer">
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
              <button className="iconButton primary sendButton" type="button" onClick={sendPrompt} disabled={!selectedProject || !prompt.trim()}>
                <Send size={18} />
              </button>
            </div>
          </section>
        </div>
      </section>

      <aside className="rightRail">
        <TerminalPane
          project={selectedProject}
          sandbox={sandbox}
          outputs={terminalOutputs}
          onExec={execCommand}
          onWrite={writeCommand}
          onTerminate={terminateCommand}
        />
        <ApprovalPanel requests={approvals} onRespond={respondToApproval} />
        <section className="activityPane">
          <div className="paneHeader">
            <div>
              <h2>Activity</h2>
              <p>{activity.length} events</p>
            </div>
          </div>
          <div className="activityList">
            {activity.map((event) => (
              <article className={`activityItem ${event.tone ?? "normal"}`} key={event.id}>
                <time>{event.time}</time>
                <strong>{event.title}</strong>
                {event.detail ? <p>{event.detail}</p> : null}
              </article>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
