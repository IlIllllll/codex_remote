import path from "node:path";

function booleanFromEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const serverConfig = {
  host: process.env.CODEX_WEB_HOST ?? "0.0.0.0",
  port: Number(process.env.CODEX_WEB_PORT ?? 4573),
  projectRoot: path.resolve(process.env.CODEX_WEB_PROJECT_ROOT ?? "/Volumes/DevDrive/program"),
  dataDir: path.resolve(process.env.CODEX_WEB_DATA_DIR ?? ".codex-web"),
  codexBin: process.env.CODEX_WEB_CODEX_BIN ?? "codex",
  allowOutsideProjectRoot: booleanFromEnv(process.env.CODEX_WEB_ALLOW_OUTSIDE_PROJECT_ROOT)
};

export const defaults = {
  sandbox: "danger-full-access",
  approvalPolicy: "never",
  model: "gpt-5.5",
  reasoningEffort: "xhigh"
} as const;
