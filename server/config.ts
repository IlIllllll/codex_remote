import path from "node:path";

export const serverConfig = {
  host: process.env.CODEX_WEB_HOST ?? "127.0.0.1",
  port: Number(process.env.CODEX_WEB_PORT ?? 4573),
  projectRoot: path.resolve(process.env.CODEX_WEB_PROJECT_ROOT ?? "/Volumes/DevDrive/program"),
  dataDir: path.resolve(process.env.CODEX_WEB_DATA_DIR ?? ".codex-web"),
  codexBin: process.env.CODEX_WEB_CODEX_BIN ?? "codex"
};

export const defaults = {
  sandbox: "danger-full-access",
  approvalPolicy: "never",
  model: "gpt-5.5",
  reasoningEffort: "xhigh"
} as const;
