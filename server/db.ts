import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { defaults, serverConfig } from "./config.js";
import type { CreateProjectInput, Project, UpdateProjectInput, UserProfile } from "./types.js";

export const DEFAULT_USER_ID = "local";

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  root_path: string;
  default_model: string;
  default_sandbox: string;
  default_approval_policy: string;
  created_at: string;
  updated_at: string;
};

type UserRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    rootPath: row.root_path,
    defaultModel: row.default_model,
    defaultSandbox: row.default_sandbox as Project["defaultSandbox"],
    defaultApprovalPolicy: row.default_approval_policy as Project["defaultApprovalPolicy"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toUser(row: UserRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ProjectStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = path.join(serverConfig.dataDir, "codex-web.sqlite")) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  listUsers(): UserProfile[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY updated_at DESC, name ASC").all() as UserRow[];
    return rows.map(toUser);
  }

  getUser(id: string): UserProfile | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  createUser(name: string): UserProfile {
    const now = new Date().toISOString();
    const user: UserProfile = {
      id: randomUUID(),
      name: name.trim(),
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare("INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.name, user.createdAt, user.updatedAt);
    return user;
  }

  listProjects(userId = DEFAULT_USER_ID): Project[] {
    const rows = this.db
      .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC, name ASC")
      .all(userId) as ProjectRow[];
    return rows.map(toProject);
  }

  getProject(id: string, userId = DEFAULT_USER_ID): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(id, userId) as
      | ProjectRow
      | undefined;
    return row ? toProject(row) : null;
  }

  createProject(input: CreateProjectInput & { rootPath: string; userId?: string }): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      userId: input.userId ?? DEFAULT_USER_ID,
      name: input.name.trim(),
      rootPath: input.rootPath,
      defaultModel: input.defaultModel?.trim() ?? defaults.model,
      defaultSandbox: input.defaultSandbox ?? defaults.sandbox,
      defaultApprovalPolicy: input.defaultApprovalPolicy ?? defaults.approvalPolicy,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO projects (
          id, user_id, name, root_path, default_model, default_sandbox, default_approval_policy, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.userId,
        project.name,
        project.rootPath,
        project.defaultModel,
        project.defaultSandbox,
        project.defaultApprovalPolicy,
        project.createdAt,
        project.updatedAt
      );

    return project;
  }

  updateProject(id: string, input: UpdateProjectInput, userId = DEFAULT_USER_ID): Project | null {
    const current = this.getProject(id, userId);
    if (!current) {
      return null;
    }

    const next: Project = {
      ...current,
      name: input.name?.trim() || current.name,
      defaultModel: input.defaultModel?.trim() ?? current.defaultModel,
      defaultSandbox: input.defaultSandbox ?? current.defaultSandbox,
      defaultApprovalPolicy: input.defaultApprovalPolicy ?? current.defaultApprovalPolicy,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `UPDATE projects
         SET name = ?, default_model = ?, default_sandbox = ?, default_approval_policy = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(next.name, next.defaultModel, next.defaultSandbox, next.defaultApprovalPolicy, next.updatedAt, id, userId);

    return next;
  }

  deleteProject(id: string, userId = DEFAULT_USER_ID): boolean {
    const result = this.db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
    return result.changes > 0;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureDefaultUser();
    this.migrateProjectsTable();
  }

  private ensureDefaultUser(): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(DEFAULT_USER_ID, "Local", now, now);
  }

  private migrateProjectsTable(): void {
    const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get();
    if (!table) {
      this.createProjectsTable();
      return;
    }

    const columns = this.db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    const hasUserId = columns.some((column) => column.name === "user_id");
    const needsRebuild = !hasUserId;

    if (!needsRebuild) {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_projects_user_updated_at ON projects(user_id, updated_at)");
      return;
    }

    this.db.exec("ALTER TABLE projects RENAME TO projects_legacy");
    this.createProjectsTable();
    const userIdSelect = hasUserId ? `COALESCE(user_id, '${DEFAULT_USER_ID}')` : `'${DEFAULT_USER_ID}'`;
    this.db.exec(`
      INSERT OR IGNORE INTO projects (
        id, user_id, name, root_path, default_model, default_sandbox, default_approval_policy, created_at, updated_at
      )
      SELECT
        id,
        ${userIdSelect},
        name,
        root_path,
        default_model,
        default_sandbox,
        default_approval_policy,
        created_at,
        updated_at
      FROM projects_legacy;
      DROP TABLE projects_legacy;
    `);
  }

  private createProjectsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '${DEFAULT_USER_ID}',
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        default_model TEXT NOT NULL DEFAULT '',
        default_sandbox TEXT NOT NULL DEFAULT 'workspace-write',
        default_approval_policy TEXT NOT NULL DEFAULT 'on-request',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, root_path),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_projects_user_updated_at ON projects(user_id, updated_at);
    `);
  }
}
