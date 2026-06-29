import fs from "node:fs";
import path from "node:path";
import { serverConfig } from "./config.js";

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

export function resolveProjectPath(inputPath: string, allowedRoot = serverConfig.projectRoot): string {
  if (!inputPath || typeof inputPath !== "string") {
    throw new PathPolicyError("Project path is required.");
  }

  const resolved = path.resolve(inputPath);
  const root = path.resolve(allowedRoot);
  const relative = path.relative(root, resolved);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }

  throw new PathPolicyError(`Project path must stay under ${root}.`);
}

export function ensureProjectDirectory(inputPath: string, options: { create?: boolean; allowedRoot?: string } = {}): string {
  const rootPath = resolveProjectPath(inputPath, options.allowedRoot);

  if (!fs.existsSync(rootPath)) {
    if (!options.create) {
      throw new PathPolicyError("Project directory does not exist.");
    }
    fs.mkdirSync(rootPath, { recursive: true });
  }

  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) {
    throw new PathPolicyError("Project path must be a directory.");
  }

  return rootPath;
}
