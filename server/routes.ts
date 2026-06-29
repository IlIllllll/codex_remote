import fs from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CodexBridge } from "./codexBridge.js";
import { defaults, serverConfig } from "./config.js";
import { DEFAULT_USER_ID, type ProjectStore } from "./db.js";
import { ensureProjectDirectory, PathPolicyError, resolveProjectPath } from "./pathPolicy.js";

const execFileAsync = promisify(execFile);

const sandboxSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);
const approvalSchema = z.enum(["untrusted", "on-request", "never"]);

const createProjectSchema = z.object({
  name: z.string().min(1),
  rootPath: z.string().min(1),
  createDirectory: z.boolean().optional(),
  gitInit: z.boolean().optional(),
  defaultModel: z.string().optional(),
  defaultSandbox: sandboxSchema.optional(),
  defaultApprovalPolicy: approvalSchema.optional()
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  defaultModel: z.string().optional(),
  defaultSandbox: sandboxSchema.optional(),
  defaultApprovalPolicy: approvalSchema.optional()
});

const createUserSchema = z.object({
  name: z.string().min(1)
});

function errorStatus(error: unknown): number {
  if (error instanceof PathPolicyError || error instanceof z.ZodError) {
    return 400;
  }
  return 500;
}

function userIdFromRequest(request: { headers: Record<string, unknown> }): string {
  const value = request.headers["x-codex-web-user-id"];
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_USER_ID;
}

export function registerRoutes(app: FastifyInstance, bridge: CodexBridge, store: ProjectStore): void {
  app.get("/api/health", async () => ({
    ok: true,
    codexPendingApprovals: bridge.getPendingServerRequests().length,
    projectRoot: serverConfig.projectRoot,
    defaults
  }));

  app.get("/api/users", async () => ({
    data: store.listUsers(),
    defaultUserId: DEFAULT_USER_ID
  }));

  app.post("/api/users", async (request, reply) => {
    try {
      const input = createUserSchema.parse(request.body);
      const user = store.createUser(input.name);
      return reply.code(201).send({ data: user });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/projects", async (request) => ({
    data: store.listProjects(userIdFromRequest(request)),
    projectRoot: serverConfig.projectRoot
  }));

  app.post("/api/system/select-directory", async (_request, reply) => {
    if (process.platform !== "darwin") {
      return reply.code(501).send({ error: "System directory picker is currently implemented for macOS only." });
    }

    try {
      const script = [
        `set defaultFolder to POSIX file ${JSON.stringify(serverConfig.projectRoot)}`,
        'set selectedFolder to choose folder with prompt "选择本地项目目录" default location defaultFolder',
        "POSIX path of selectedFolder"
      ].join("\n");
      const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 120_000 });
      const selectedPath = stdout.trim().replace(/\/+$/, "");
      const rootPath = resolveProjectPath(selectedPath || serverConfig.projectRoot);
      return { data: { rootPath } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("User canceled")) {
        return reply.code(499).send({ error: "Directory selection was canceled." });
      }
      return reply.code(errorStatus(error)).send({ error: message });
    }
  });

  app.post("/api/projects", async (request, reply) => {
    try {
      const input = createProjectSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      if (!store.getUser(userId)) {
        return reply.code(404).send({ error: "User not found." });
      }
      const rootPath = ensureProjectDirectory(input.rootPath, { create: input.createDirectory });

      if (input.gitInit && !fs.existsSync(`${rootPath}/.git`)) {
        execFileSync("git", ["init"], { cwd: rootPath, stdio: "ignore" });
      }

      const project = store.createProject({ ...input, rootPath, userId });
      return reply.code(201).send({ data: project });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    try {
      const input = updateProjectSchema.parse(request.body);
      const project = store.updateProject(request.params.id, input, userIdFromRequest(request));
      if (!project) {
        return reply.code(404).send({ error: "Project not found." });
      }
      return { data: project };
    } catch (error) {
      return reply.code(errorStatus(error)).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const deleted = store.deleteProject(request.params.id, userIdFromRequest(request));
    if (!deleted) {
      return reply.code(404).send({ error: "Project not found." });
    }
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { archived?: string; search?: string } }>(
    "/api/projects/:id/threads",
    async (request, reply) => {
      const project = store.getProject(request.params.id, userIdFromRequest(request));
      if (!project) {
        return reply.code(404).send({ error: "Project not found." });
      }

      try {
        const result = await bridge.request("thread/list", {
          cwd: project.rootPath,
          limit: 50,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived: request.query.archived === "true",
          searchTerm: request.query.search || null,
          useStateDbOnly: false
        });
        return result;
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  app.get<{ Params: { threadId: string }; Querystring: { projectId?: string } }>("/api/threads/:threadId", async (request, reply) => {
    try {
      const userId = userIdFromRequest(request);
      const project = request.query.projectId ? store.getProject(request.query.projectId, userId) : null;
      if (request.query.projectId && !project) {
        return reply.code(404).send({ error: "Project not found." });
      }

      const result = await bridge.request("thread/read", {
        threadId: request.params.threadId,
        includeTurns: true
      });
      const thread = (result as { thread?: { cwd?: string } }).thread;
      if (project && thread?.cwd !== project.rootPath) {
        return reply.code(403).send({ error: "Thread is not visible in this user's selected project." });
      }
      return result;
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
