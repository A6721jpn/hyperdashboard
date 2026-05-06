import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

export class CodexSlideBridge {
  constructor({ cwd, mock = process.env.SLIDE_BUILDER_MOCK_CODEX === "1" } = {}) {
    this.cwd = cwd;
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

    const extraArgs = parseExtraArgs(process.env.CODEX_APP_SERVER_ARGS || "");
    const command = process.platform === "win32" ? "cmd.exe" : "codex";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", ["codex", "app-server", ...extraArgs].map(quoteForCmd).join(" ")]
      : ["app-server", ...extraArgs];
    this.proc = spawn(command, args, {
      cwd: this.cwd,
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
        name: "hypardashboard_slide_builder",
        title: "Hypardashboard Slide Builder",
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
    if (!this.proc?.stdin) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }

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
    this.proc?.stdin?.write(`${JSON.stringify({ method, params })}\n`);
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
        ],
      };
    }

    await this.ensureStarted();
    return await this.request("model/list", { limit: 50, includeHidden: false }, 30000);
  }

  async streamBuild(payload, emit) {
    if (this.mock) {
      await mockBuild(payload, emit);
      return;
    }

    await this.ensureStarted();
    let codexThreadId = payload.codexThreadId;

    if (!codexThreadId) {
      const started = await this.request("thread/start", {
        model: payload.model,
        cwd: this.cwd,
        serviceName: "hypardashboard_slide_builder",
      }, 60000);
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
      }, 60000);
      this.loadedThreads.add(codexThreadId);
    }

    const inputText = composeSlideInput(payload);

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

      const timeout = setTimeout(() => finish(new Error("turn/start stream timed out")), 1800000);

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
          if (item.type === "agentMessage" && item.text && message.method === "item/completed") {
            emit({ type: "final", text: item.text });
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
          cwd: this.cwd,
        }, 60000);
        currentTurnId = result?.turn?.id ?? currentTurnId;
      } catch (error) {
        finish(error);
      }
    });
  }
}

function composeSlideInput(payload) {
  const brief = payload.brief ?? {};
  const plan = Array.isArray(payload.plan) ? payload.plan : [];

  return [
    "<slide_builder_system>",
    "You are Codex building an editable native Google Slides deck from a browser-submitted brief.",
    "Follow these rules:",
    "- Use the Google Slides / Google Drive connector workflow when available.",
    "- For a new deck, prefer creating a local editable PPTX first, rendering or checking it, then importing it as native Google Slides with upload_mode native_google_slides.",
    "- For an existing template URL, copy the template first and edit the copy only.",
    "- Keep the final deliverable an editable Google Slides deck, not image-only slides.",
    "- Use connector readback to confirm presentation id, title, slide count, and slide object IDs.",
    "- Use fresh slide thumbnails for visual QA of touched slides.",
    "- Adopt the no-zabuton editorial baseline as the default visual system: open typography, generous whitespace, direct labels, native rules/rails, and a few strong visual signals.",
    "- Use the accepted baseline patterns by default: type-led statement slide, native rail or axis with separately anchored labels, and sparse decision slide without competing side notes.",
    "- Treat the user's prompt as flavor on top of the baseline. It may change mood, palette, imagery, pacing, examples, or emphasis, but it should not reintroduce decorative cards, boxed prose, or fragile alignment.",
    "- If user flavor conflicts with the baseline, keep the baseline unless the user explicitly asks for the departure and it improves the deck's job.",
    "- Keep slides visually clean: one job per slide, short titles, readable text, no clipped text, no stale placeholders.",
    "- Avoid unnecessary containers: no decorative cards, panels, boxed prose, background rectangles, pill stacks, or 'zabuton' behind text by default.",
    "- Use open typography first. Prefer whitespace, rules, leader lines, direct labels, and small anchor marks over card grids.",
    "- Allow a visible box only when it holds a real artifact such as a screenshot, chart, table, code/output sample, or quote artifact.",
    "- Treat excessive boxes or panels as a thumbnail QA defect and simplify before handoff.",
    "- Do not fake axes, timelines, tables, or alignment by typing spaced strings, repeated glyphs, or monospaced text. Use native lines/connectors/shapes and separate anchored labels.",
    "- For every rail, axis, timeline, or process diagram, make each dot, tick, label, and connector its own editable element with explicit geometry.",
    "- Never put multiple independent labels into one text box and align them with spaces. Use one text box per label or a real table.",
    "- Treat accidental label wrapping, orphaned characters, uneven baselines, axis/tick/label misalignment, text collisions, and side-note/headline overlap as visual QA failures.",
    "- After any visual patch, fetch a fresh large thumbnail again. Do not claim QA passed from a pre-patch thumbnail, API success, or object JSON alone.",
    "- If a thumbnail cannot be inspected, report the slide as unresolved instead of saying QA passed.",
    "- If current facts matter, verify them before putting them in the deck.",
    "- Final answer must include the Google Slides link, title, slide count, QA status, and any unresolved issue.",
    "</slide_builder_system>",
    "",
    "<capability_routing>",
    "The browser app has already converted the raw user prompt into the structured brief below.",
    "Do not treat the raw prompt as the whole task. Use the normalized brief, proposed slide plan, and QA contract.",
    "Use helpful plugins/MCP if they are available in the Codex runtime:",
    "- Presentations plugin: author the editable local PPTX draft and render/inspect it.",
    "- Google Drive / Google Slides connector: import as native Google Slides, copy templates, read deck structure, batch edit existing slides, and fetch thumbnails.",
    "- node_repl: transform source material or generate helper JSON only; do not call connectors through node_repl.",
    "- openaiDeveloperDocs MCP: verify current OpenAI/Codex docs only when that affects the deck-generation workflow.",
    "</capability_routing>",
    "",
    "<user_brief>",
    JSON.stringify(brief, null, 2),
    "</user_brief>",
    "",
    "<proposed_slide_plan>",
    JSON.stringify(plan, null, 2),
    "</proposed_slide_plan>",
    "",
    payload.codexPrompt || "Create the deck from this brief and plan.",
  ].join("\n");
}

function parseExtraArgs(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, "")) ?? [];
}

function quoteForCmd(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function mockBuild(payload, emit) {
  const codexThreadId = payload.codexThreadId || `mock-slide-thread-${Date.now()}`;
  emit({ type: "thread", codexThreadId });
  const title = payload.brief?.title || "Untitled deck";
  const slideCount = Array.isArray(payload.plan) ? payload.plan.length : 6;
  const response = [
    `Mock build for "${title}"`,
    "",
    `Created a ${slideCount}-slide native Google Slides draft using the requested workflow.`,
    "",
    "Google Slides: https://docs.google.com/presentation/d/mock-slide-builder-demo/edit",
    "",
    "QA status:",
    "- PPTX draft rendered",
    "- Native Google Slides import confirmed",
    "- Connector readback confirmed title and slide count",
    "- Fresh thumbnails checked for all slides",
  ].join("\n");

  for (let index = 0; index < response.length; index += 24) {
    emit({ type: "delta", text: response.slice(index, index + 24) });
    await delay(25);
  }
  emit({ type: "done" });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
