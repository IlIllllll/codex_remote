import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Fastify from "fastify";
import { CodexBridge } from "./codexBridge.js";
import { serverConfig } from "./config.js";
import { ProjectStore } from "./db.js";
import { registerRoutes } from "./routes.js";
import { attachSocketServer } from "./socket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const app = Fastify({ logger: true });
const store = new ProjectStore();
const bridge = new CodexBridge();

registerRoutes(app, bridge, store);

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith("/api") || request.raw.url?.startsWith("/ws")) {
    return reply.code(404).send({ error: "Not found." });
  }
  if (!fs.existsSync(distDir)) {
    return reply.code(404).send({ error: "Frontend has not been built. Run npm run dev for Vite." });
  }

  const requestPath = new URL(request.raw.url ?? "/", "http://localhost").pathname;
  const relativePath = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
  const candidate = path.resolve(distDir, relativePath);
  const safeCandidate = candidate === distDir || candidate.startsWith(`${distDir}${path.sep}`);
  const filePath = safeCandidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(distDir, "index.html");
  const extension = path.extname(filePath);

  return reply.type(mimeTypes[extension] ?? "application/octet-stream").send(fs.createReadStream(filePath));
});

attachSocketServer(app.server, bridge, store);

process.on("SIGINT", async () => {
  bridge.stop();
  store.close();
  await app.close();
  process.exit(0);
});

await bridge.start();
await app.listen({ host: serverConfig.host, port: serverConfig.port });
