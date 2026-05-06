import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const host = "localhost";
const port = 46211;
const codexAppServerUrl = process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:46212";
const cwd = process.cwd();
const generatedDir = path.join(cwd, "public", "generated");
const startedAt = Date.now();

let latestLimits = {
  imagegenRemaining: null,
  codexRemaining: null,
  resetLabel: "Waiting for Codex App Server",
};

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function asInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildImagePrompt(payload, index, total) {
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    throw new Error("Main prompt is required.");
  }

  const style = typeof payload.style === "string" ? payload.style.trim() : "";
  const font = typeof payload.font === "string" ? payload.font.trim() : "";
  const size = typeof payload.size === "string" ? payload.size : "1024x1024";

  return [
    "Generate exactly one real raster image with the built-in image generation tool.",
    "No SVG, HTML, CSS, canvas, placeholders, mockups, or fabricated files.",
    "Brief:",
    prompt,
    style ? `Style: ${style}` : "",
    font ? `Typography: ${font}.` : "",
    `Size preset: ${size}.`,
    `Variation ${index + 1} of ${total}.`,
    "After generating the image, final answer: done",
  ].filter(Boolean).join("\n");
}

function rpcClient() {
  const ws = new WebSocket(codexAppServerUrl);
  let nextId = 1;
  const pending = new Map();
  const turnWaiters = new Map();
  const imageItems = [];
  let lastAgentMessage = "";

  function send(method, params, timeoutMs = 60000) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function close() {
    try {
      ws.close();
    } catch {
      // The socket may already be closed by the server.
    }
  }

  function waitForTurn(turnId, timeoutMs = 15 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        turnWaiters.delete(turnId);
        reject(new Error("Timed out waiting for Codex App Server image generation."));
      }, timeoutMs);
      turnWaiters.set(turnId, { resolve, reject, timer });
    });
  }

  const open = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Could not connect to Codex App Server at ${codexAppServerUrl}`)), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Codex App Server websocket error at ${codexAppServerUrl}`));
    };
  });

  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if ("id" in message && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    if (message.method === "item/completed") {
      const item = message.params?.item;
      if (item?.type === "imageGeneration" && item.result) {
        imageItems.push(item);
      }
      if (item?.type === "agentMessage" && item.text) {
        lastAgentMessage = item.text;
      }
      return;
    }

    if (message.method === "account/rateLimits/updated") {
      const limits = message.params?.rateLimits;
      latestLimits = {
        imagegenRemaining: null,
        codexRemaining: typeof limits?.primary?.usedPercent === "number" ? Math.max(0, 100 - limits.primary.usedPercent) : null,
        resetLabel: limits?.primary?.resetsAt ? `Codex resets ${new Date(limits.primary.resetsAt * 1000).toLocaleString()}` : "Codex rate limits updated",
      };
      return;
    }

    if (message.method === "error") {
      const errorTurnId = message.params?.turnId;
      const errorMessage = message.params?.error?.message ?? "Codex App Server reported an error.";
      const additionalDetails = message.params?.error?.additionalDetails;
      console.warn(
        JSON.stringify({
          event: "codex-app-server-error",
          turnId: errorTurnId,
          willRetry: Boolean(message.params?.willRetry),
          errorMessage,
          additionalDetails,
        }),
      );
      if (message.params?.willRetry) {
        return;
      }

      const waiter = turnWaiters.get(errorTurnId);
      if (waiter) {
        turnWaiters.delete(errorTurnId);
        clearTimeout(waiter.timer);
        waiter.reject(new Error(additionalDetails ? `${errorMessage} ${additionalDetails}` : errorMessage));
      }
      return;
    }

    if (message.method === "turn/completed") {
      const turn = message.params?.turn;
      const waiter = turnWaiters.get(turn?.id);
      if (waiter) {
        turnWaiters.delete(turn.id);
        clearTimeout(waiter.timer);
        if (turn.status === "failed") {
          waiter.reject(new Error(turn.error?.message ?? "Codex App Server turn failed."));
        } else {
          waiter.resolve(turn);
        }
      }
    }
  };

  return { open, send, close, waitForTurn, imageItems, getLastAgentMessage: () => lastAgentMessage };
}

async function saveImage(item, requestId, index) {
  await mkdir(generatedDir, { recursive: true });
  const filename = `${requestId}-${String(index + 1).padStart(2, "0")}.png`;
  const filePath = path.join(generatedDir, filename);
  await writeFile(filePath, Buffer.from(item.result, "base64"));
  return {
    imageUrl: `/generated/${filename}`,
    revisedPrompt: item.revisedPrompt ?? undefined,
    savedPath: filePath,
  };
}

async function generateSingleWithCodexAppServer(payload, requestId, index, total) {
  const started = Date.now();
  const prompt = buildImagePrompt(payload, index, total);
  const client = rpcClient();

  await client.open;

  try {
    await client.send("initialize", {
      clientInfo: { name: "imagegen-app", title: "Imagegen App", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });

    const threadResult = await client.send("thread/start", {
      model: "gpt-5.5",
      serviceTier: "fast",
      cwd,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      baseInstructions: "Use built-in image generation when requested. Never fabricate images.",
    });

    const threadId = threadResult.thread.id;
    const turnResult = await client.send("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      model: "gpt-5.5",
      serviceTier: "fast",
      effort: "low",
    });
    const turnId = turnResult.turn.id;
    console.log(JSON.stringify({ event: "imagegen-slot-started", requestId, slot: index + 1, total, turnId }));

    await client.waitForTurn(turnId);

    if (client.imageItems.length < 1) {
      throw new Error(`Codex App Server returned no image for slot ${index + 1}. Last message: ${client.getLastAgentMessage()}`);
    }

    const image = await saveImage(client.imageItems[0], requestId, index);
    console.log(JSON.stringify({ event: "imagegen-slot-completed", requestId, slot: index + 1, durationMs: Date.now() - started }));
    return { ...image, durationMs: Date.now() - started };
  } finally {
    client.close();
  }
}

async function generateWithCodexAppServer(payload) {
  const count = clamp(asInteger(payload.count, 3), 3, 10);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const images = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      generateSingleWithCodexAppServer(payload, requestId, index, count),
    ),
  );

  return {
    provider: "codex-app-server",
    images,
  };
}

async function generateOneWithCodexAppServer(payload) {
  const total = clamp(asInteger(payload.total ?? payload.count, 3), 3, 10);
  const index = clamp(asInteger(payload.index, 0), 0, total - 1);
  const rawRequestId = typeof payload.requestId === "string" ? payload.requestId : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestId = rawRequestId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || `${Date.now()}`;
  const image = await generateSingleWithCodexAppServer(payload, requestId, index, total);

  return {
    provider: "codex-app-server",
    image,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        port,
        imagegenProvider: "codex-app-server",
        codexAppServerUrl,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/codex/tokens") {
      sendJson(response, 200, latestLimits);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/imagegen") {
      const payload = await readJson(request);
      const result = await generateWithCodexAppServer(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/imagegen/slot") {
      const payload = await readJson(request);
      const result = await generateOneWithCodexAppServer(payload);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
      uptimeMs: Date.now() - startedAt,
    });
  }
});

server.listen(port, host, () => {
  console.log(`Imagegen API listening at http://${host}:${port}`);
  console.log(`Imagegen provider: Codex App Server (${codexAppServerUrl})`);
});
