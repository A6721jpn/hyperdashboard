import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerBridge, sendJson, serveLocalImage } from "./codex-app-server.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(rootDir, "dist");
const bridge = new CodexAppServerBridge();

export async function createChatServer({ vite } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, mock: bridge.mock });
        return;
      }

      if (url.pathname === "/api/models") {
        sendJson(res, 200, await bridge.listModels());
        return;
      }

      if (url.pathname === "/api/local-image") {
        serveLocalImage(url, res);
        return;
      }

      if (url.pathname === "/api/chat/turn" && req.method === "POST") {
        await handleTurn(req, res);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "Unknown API route" });
        return;
      }

      if (vite) {
        vite.middlewares(req, res);
        return;
      }

      await serveStatic(url.pathname, res);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : "Server error" });
      } else {
        res.end();
      }
    }
  });
}

async function handleTurn(req, res) {
  const body = await readBody(req);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });

  const emit = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await bridge.streamTurn(body, emit);
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : "Turn failed" });
  } finally {
    res.end();
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(distDir, cleanPath));
  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    const index = join(distDir, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(index, "utf8"));
    return;
  }

  res.writeHead(200, { "Content-Type": mimeFor(extname(filePath)) });
  createReadStream(filePath).pipe(res);
}

function mimeFor(extension) {
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 5174);
  const server = await createChatServer();
  server.listen(port, "localhost", () => {
    console.log(`Hypardashboard Chat App listening on http://localhost:${port}/`);
  });
}
