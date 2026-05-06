import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

export class CodexAppServerBridge {
  constructor({ mock = process.env.CHAT_APP_MOCK_CODEX === "1" } = {}) {
    this.mock = mock;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new EventEmitter();
    this.initialized = false;
    this.loadedThreads = new Set();
  }

  async ensureStarted() {
    if (this.mock || this.initialized) {
      return;
    }

    const command = process.platform === "win32" ? "cmd.exe" : "codex";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "codex app-server"] : ["app-server"];
    this.proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (${code ?? signal ?? "unknown"})`);
      for (const { reject } of this.pending.values()) {
        reject(error);
      }
      this.pending.clear();
      this.initialized = false;
      this.proc = null;
    });

    this.proc.stderr.on("data", (chunk) => {
      this.events.emit("server-log", chunk.toString("utf8"));
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "hypardashboard_chat_app",
        title: "Hypardashboard Chat App",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.events.emit("server-log", line);
      return;
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve: onResolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "Codex App Server JSON-RPC error"));
      } else {
        onResolve(message.result ?? {});
      }
      return;
    }

    if (message.method) {
      this.events.emit("notification", message);
    }
  }

  request(method, params = {}, timeoutMs = 180000) {
    const id = this.nextId++;
    const message = { method, id, params };

    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async listModels() {
    if (this.mock) {
      return {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort })),
            inputModalities: ["text", "image"],
            isDefault: true,
          },
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort })),
            inputModalities: ["text", "image"],
            isDefault: false,
          },
          {
            id: "gpt-5.4-mini",
            model: "gpt-5.4-mini",
            displayName: "GPT-5.4 Mini",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort })),
            inputModalities: ["text", "image"],
            isDefault: false,
          },
        ],
      };
    }

    await this.ensureStarted();
    return await this.request("model/list", { limit: 50, includeHidden: false }, 30000);
  }

  async streamTurn(payload, emit) {
    if (this.mock) {
      const codexThreadId = payload.codexThreadId || `mock-thread-${Date.now()}`;
      emit({ type: "thread", codexThreadId });
      const text = `Mock Codex reply (${payload.model}, ${payload.effort}).\n\n` +
        `I received: ${payload.text}\n\n` +
        "**Three angles to explore:**\n\n" +
        "- A sharper question\n" +
        "- A concrete next experiment\n" +
        "- A visual metaphor\n\n" +
        "`Markdown` should render here.";
      for (let index = 0; index < text.length; index += 18) {
        emit({ type: "delta", text: text.slice(index, index + 18) });
        await delay(20);
      }
      emit({
        type: "image",
        image: {
          url: "data:image/svg+xml;base64," + Buffer.from(mockSvg()).toString("base64"),
          alt: "Mock generated brainstorming preview",
        },
      });
      emit({ type: "done" });
      return;
    }

    await this.ensureStarted();
    let codexThreadId = payload.codexThreadId;

    if (!codexThreadId) {
      const started = await this.request("thread/start", {
        model: payload.model,
        cwd: payload.cwd || undefined,
        serviceName: "hypardashboard_chat_app",
      });
      codexThreadId = started?.thread?.id;
      if (!codexThreadId) {
        throw new Error("thread/start did not return a thread id");
      }
      this.loadedThreads.add(codexThreadId);
      emit({ type: "thread", codexThreadId });
    } else if (!this.loadedThreads.has(codexThreadId)) {
      await this.request("thread/resume", {
        threadId: codexThreadId,
        model: payload.model,
      });
      this.loadedThreads.add(codexThreadId);
    }

    const inputText = composeInput(payload.systemPrompt, payload.text, payload.priorTranscript);
    const seenImages = new Set();

    await new Promise(async (resolveTurn, rejectTurn) => {
      let currentTurnId = null;
      let settled = false;

      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.events.off("notification", onNotification);
        if (error) {
          rejectTurn(error);
        } else {
          resolveTurn();
        }
      };

      const timeout = setTimeout(() => finish(new Error("turn/start stream timed out")), 240000);

      const onNotification = (message) => {
        const params = message.params ?? {};
        const threadId = params.threadId ?? params.thread?.id ?? params.turn?.threadId;
        if (threadId && threadId !== codexThreadId) {
          return;
        }

        if (message.method === "turn/started" && params.turn?.id) {
          currentTurnId = params.turn.id;
          return;
        }

        if (message.method === "item/agentMessage/delta") {
          const text = params.delta ?? params.text ?? params.content ?? "";
          if (text) {
            emit({ type: "delta", text });
          }
          return;
        }

        if (message.method === "item/completed" || message.method === "item/started") {
          const item = params.item ?? {};
          const finalText = item.type === "agentMessage" ? item.text : "";
          if (finalText && message.method === "item/completed") {
            emit({ type: "final", text: finalText });
          }
          for (const image of extractImages(item)) {
            const key = image.url || image.path;
            if (key && !seenImages.has(key)) {
              seenImages.add(key);
              emit({ type: "image", image: normalizeImage(image) });
            }
          }
          return;
        }

        if (message.method === "turn/completed") {
          if (!currentTurnId || !params.turn?.id || params.turn.id === currentTurnId) {
            emit({ type: "done" });
            finish();
          }
        }
      };

      this.events.on("notification", onNotification);

      try {
        const result = await this.request("turn/start", {
          threadId: codexThreadId,
          input: [{ type: "text", text: inputText }],
          model: payload.model,
          effort: payload.effort,
          cwd: payload.cwd || undefined,
        });
        currentTurnId = result?.turn?.id ?? currentTurnId;
      } catch (error) {
        finish(error);
      }
    });
  }
}

export function serveLocalImage(url, res) {
  const requested = url.searchParams.get("path");
  if (!requested) {
    sendJson(res, 400, { error: "Missing image path" });
    return;
  }

  const filePath = resolve(requested);
  const extension = extname(filePath).toLowerCase();
  if (!imageExtensions.has(extension) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Image not found" });
    return;
  }

  res.writeHead(200, { "Content-Type": mimeFor(extension), "Cache-Control": "no-store" });
  createReadStream(filePath).pipe(res);
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function composeInput(systemPrompt, text, priorTranscript) {
  const parts = [];

  if (systemPrompt?.trim()) {
    parts.push(
      "<brainstorming_system_prompt>",
      systemPrompt.trim(),
      "</brainstorming_system_prompt>",
      "",
    );
  }

  if (priorTranscript?.trim()) {
    parts.push(
      "<prior_conversation_context>",
      "The user edited and resent an earlier message. Continue from this preserved context only:",
      priorTranscript.trim(),
      "</prior_conversation_context>",
      "",
    );
  }

  parts.push(text);
  return parts.join("\n");
}

function extractImages(value, results = []) {
  if (!value || typeof value !== "object") {
    return results;
  }

  const type = value.type ?? value.kind;
  const url = value.url ?? value.imageUrl;
  const path = value.path ?? value.localPath;

  if ((type === "image" || type === "localImage" || type === "imageView" || isImageRef(url) || isImageRef(path)) && (url || path)) {
    results.push({ url, path, alt: value.alt ?? value.title ?? "Generated image" });
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        extractImages(item, results);
      }
    } else if (nested && typeof nested === "object") {
      extractImages(nested, results);
    }
  }

  return results;
}

function normalizeImage(image) {
  if (image.url) {
    return { url: image.url, alt: image.alt ?? "Generated image" };
  }

  return {
    url: `/api/local-image?path=${encodeURIComponent(image.path)}`,
    alt: image.alt ?? "Generated image",
  };
}

function isImageRef(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (value.startsWith("data:image/")) {
    return true;
  }
  return imageExtensions.has(extname(value.split("?")[0]).toLowerCase());
}

function mimeFor(extension) {
  switch (extension) {
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">
    <rect width="800" height="480" fill="#f5f7f4"/>
    <rect x="52" y="48" width="696" height="384" rx="18" fill="#ffffff" stroke="#0f766e" stroke-width="6"/>
    <text x="90" y="140" font-family="Arial" font-size="44" font-weight="700" fill="#202b27">Brainstorm preview</text>
    <text x="90" y="202" font-family="Arial" font-size="26" fill="#52645c">Inline image output from the Codex stream</text>
    <circle cx="642" cy="142" r="54" fill="#e3b84a"/>
    <path d="M104 336 C220 230 326 386 438 286 S604 318 702 236" fill="none" stroke="#236491" stroke-width="14" stroke-linecap="round"/>
  </svg>`;
}
