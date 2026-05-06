import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(rootDir, "dist");
const maxLogLines = 180;

const appDefinitions = [
  {
    id: "image",
    title: "Image Gen",
    description: "Prompt lab and generated asset gallery",
    category: "create",
    iconClass: "image",
    port: ":5173",
    mode: "Codex image worker",
    url: "http://localhost:5173",
    healthCheckUrl: "http://localhost:46211/api/health",
    command: "npm run dev",
    stopPorts: [5173, 46211, 46212],
    workspacePath: join(rootDir, "imagegen-app"),
    notes:
      "Runs the Vite client, Codex App Server bridge, and image API. Use this for prompt tests and generated asset review.",
  },
  {
    id: "chat",
    title: "Brainstorm Chat",
    description: "Private 1-on-1 thinking room",
    category: "think",
    iconClass: "chat",
    port: ":5174",
    mode: "Local chat server",
    url: "http://localhost:5174",
    healthCheckUrl: "http://localhost:5174/api/health",
    command: "npm run dev",
    stopPorts: [5174],
    workspacePath: join(rootDir, "chat-app"),
    notes:
      "Runs the chat UI and local Codex bridge server. It is the quick room for drafting, evaluating, and exploring ideas.",
  },
  {
    id: "slide",
    title: "Slide Builder",
    description: "Deck outline, layout, and export flow",
    category: "present",
    iconClass: "slide",
    port: ":46310",
    mode: "Preview and export",
    url: "http://localhost:46310",
    healthCheckUrl: "http://localhost:46310/api/health",
    command: "npm run dev",
    stopPorts: [46310, 46311],
    workspacePath: join(rootDir, "slide-builder"),
    notes:
      "Runs the slide builder preview server and Codex slide bridge. Recent outputs remain under the slide-builder output folder.",
  },
];

const runtime = new Map(
  appDefinitions.map((definition) => [
    definition.id,
    {
      child: null,
      status: "Stopped",
      health: "Not checked yet",
      managed: false,
      pid: null,
      stopping: false,
      logs: [`${stamp()} Registered ${definition.title}`],
    },
  ]),
);

function stamp() {
  return `[${new Date().toLocaleTimeString("en-GB", { hour12: false })}]`;
}

function log(appId, message, stream = "controller") {
  const state = runtime.get(appId);
  if (!state) {
    return;
  }
  state.logs = [...state.logs, `${stamp()} ${stream}: ${message}`].slice(-maxLogLines);
}

function statusClassFor(status) {
  switch (status) {
    case "Running":
      return "running";
    case "Starting":
      return "starting";
    case "Idle":
      return "warning";
    case "Error":
      return "error";
    default:
      return "stopped";
  }
}

async function checkHealth(definition, timeoutMs = 1500) {
  if (!definition.healthCheckUrl) {
    return { ok: true, label: "No health check configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(definition.healthCheckUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      ok: response.status >= 200 && response.status < 400,
      label: `${response.status} ${response.statusText || "OK"}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      label: error instanceof Error ? error.message : "Health check failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshState(definition) {
  const state = runtime.get(definition.id);
  if (!state) {
    return;
  }

  if (state.status === "Starting" && state.managed) {
    return;
  }

  const health = await checkHealth(definition);
  state.health = health.ok ? `Healthy: ${health.label}` : `Offline: ${health.label}`;

  if (health.ok) {
    state.status = "Running";
    return;
  }

  if (state.managed && state.child && state.status !== "Error") {
    state.status = "Starting";
    return;
  }

  if (!state.managed && state.status !== "Error") {
    state.status = "Stopped";
  }
}

async function snapshot() {
  await Promise.all(appDefinitions.map(refreshState));
  return {
    apps: appDefinitions.map((definition) => {
      const state = runtime.get(definition.id);
      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        category: definition.category,
        status: state.status,
        statusClass: statusClassFor(state.status),
        port: definition.port,
        mode: definition.mode,
        url: definition.url,
        command: definition.command,
        path: definition.workspacePath,
        health: state.health,
        healthCheckUrl: definition.healthCheckUrl,
        notes: definition.notes,
        iconClass: definition.iconClass,
        pid: state.pid,
        managed: state.managed,
        logs: state.logs,
      };
    }),
  };
}

async function waitForHealthy(definition) {
  const state = runtime.get(definition.id);
  for (let attempt = 1; attempt <= 28; attempt += 1) {
    const health = await checkHealth(definition, 1000);
    state.health = health.ok ? `Healthy: ${health.label}` : `Waiting: ${health.label}`;
    if (health.ok) {
      state.status = "Running";
      log(definition.id, `Health check passed at ${definition.healthCheckUrl}`);
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  state.status = "Error";
  state.health = `Health check did not pass: ${definition.healthCheckUrl}`;
  log(definition.id, state.health, "error");
}

async function startApp(definition) {
  const state = runtime.get(definition.id);
  if (!state) {
    throw new Error("Unknown app");
  }

  const health = await checkHealth(definition);
  if (health.ok) {
    state.status = "Running";
    state.health = `Healthy: ${health.label}`;
    log(definition.id, "Already reachable; leaving existing process in place");
    return;
  }

  if (state.child) {
    state.status = "Starting";
    log(definition.id, "Start requested while a managed process is already active");
    return;
  }

  state.status = "Starting";
  state.health = "Starting process";
  state.managed = true;
  state.stopping = false;
  log(definition.id, `Starting '${definition.command}' in ${definition.workspacePath}`);

  const child = spawn(definition.command, [], {
    cwd: definition.workspacePath,
    env: process.env,
    shell: true,
    windowsHide: true,
  });

  state.child = child;
  state.pid = child.pid ?? null;

  child.stdout?.on("data", (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
      log(definition.id, line, "stdout");
    }
  });

  child.stderr?.on("data", (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
      log(definition.id, line, "stderr");
    }
  });

  child.on("error", (error) => {
    state.status = "Error";
    state.health = error.message;
    log(definition.id, error.message, "error");
  });

  child.on("exit", (code, signal) => {
    state.child = null;
    state.pid = null;
    state.managed = false;
    if (state.stopping) {
      state.status = "Stopped";
      state.health = "Stopped by dashboard";
      state.stopping = false;
      log(definition.id, `Stopped managed process (${signal ?? code ?? 0})`);
      return;
    }

    if (code === 0) {
      state.status = "Stopped";
      state.health = "Process exited normally";
      log(definition.id, "Process exited normally");
      return;
    }

    state.status = "Error";
    state.health = `Process exited with ${signal ?? `code ${code}`}`;
    log(definition.id, state.health, "error");
  });

  void waitForHealthy(definition);
}

function taskkill(pid) {
  return new Promise((resolvePromise) => {
    if (!pid) {
      resolvePromise();
      return;
    }

    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("exit", () => resolvePromise());
    killer.on("error", () => resolvePromise());
  });
}

function stopProcessesOnPorts(ports) {
  return new Promise((resolvePromise) => {
    if (!ports?.length) {
      resolvePromise();
      return;
    }

    const portList = ports.map((port) => Number(port)).filter(Number.isFinite).join(",");
    const command = [
      `$ports=@(${portList})`,
      "$connections=Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue",
      "$pids=$connections | Select-Object -ExpandProperty OwningProcess -Unique",
      "foreach($procId in $pids){ if($procId -and $procId -ne $PID){ Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }",
    ].join("; ");

    const killer = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("exit", () => resolvePromise());
    killer.on("error", () => resolvePromise());
  });
}

async function stopApp(definition) {
  const state = runtime.get(definition.id);
  if (!state) {
    throw new Error("Unknown app");
  }

  if (!state.child || !state.pid) {
    const health = await checkHealth(definition);
    if (!health.ok) {
      state.managed = false;
      state.status = "Stopped";
      state.health = "Stopped";
      log(definition.id, "Already stopped");
      return;
    }

    state.health = "Stopping externally detected process";
    log(definition.id, `Stopping processes on registered ports: ${definition.stopPorts.join(", ")}`);
    await stopProcessesOnPorts(definition.stopPorts);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
    const afterStop = await checkHealth(definition);
    state.managed = false;
    state.status = afterStop.ok ? "Error" : "Stopped";
    state.health = afterStop.ok ? "Port is still responding after stop" : "Stopped by dashboard";
    log(definition.id, state.health, afterStop.ok ? "error" : "controller");
    return;
  }

  state.stopping = true;
  state.health = "Stopping process";
  log(definition.id, `Stopping managed PID ${state.pid}`);
  await taskkill(state.pid);
}

async function restartApp(definition) {
  await stopApp(definition);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  await startApp(definition);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/apps") {
    sendJson(response, 200, await snapshot());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/apps/start-all") {
    await Promise.all(appDefinitions.map(startApp));
    sendJson(response, 200, await snapshot());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/apps/stop-all") {
    await Promise.all(appDefinitions.map(stopApp));
    sendJson(response, 200, await snapshot());
    return true;
  }

  const match = url.pathname.match(/^\/api\/apps\/([^/]+)\/(start|stop|restart|logs)$/);
  if (!match) {
    return false;
  }

  const definition = appDefinitions.find((app) => app.id === match[1]);
  if (!definition) {
    sendJson(response, 404, { error: "Unknown app" });
    return true;
  }

  try {
    if (request.method === "POST" && match[2] === "start") {
      await startApp(definition);
      sendJson(response, 200, await snapshot());
      return true;
    }
    if (request.method === "POST" && match[2] === "stop") {
      await stopApp(definition);
      sendJson(response, 200, await snapshot());
      return true;
    }
    if (request.method === "POST" && match[2] === "restart") {
      await restartApp(definition);
      sendJson(response, 200, await snapshot());
      return true;
    }
    if (request.method === "DELETE" && match[2] === "logs") {
      runtime.get(definition.id).logs = [`${stamp()} controller: Logs cleared`];
      sendJson(response, 200, await snapshot());
      return true;
    }
  } catch (error) {
    log(definition.id, error instanceof Error ? error.message : "Action failed", "error");
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Action failed" });
    return true;
  }

  sendJson(response, 405, { error: "Method not allowed" });
  return true;
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(distDir, cleanPath));
  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    const index = join(distDir, "index.html");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(await readFile(index, "utf8"));
    return;
  }

  response.writeHead(200, { "Content-Type": mimeFor(extname(filePath)) });
  createReadStream(filePath).pipe(response);
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
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

export function createDashboardServer({ vite } = {}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(request, response, url);
        if (!handled) {
          sendJson(response, 404, { error: "Unknown API route" });
        }
        return;
      }

      if (vite) {
        vite.middlewares(request, response);
        return;
      }

      await serveStatic(url.pathname, response);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Server error" });
      } else {
        response.end();
      }
    }
  });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 5175);
  const server = createDashboardServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Hypardashboard listening on http://127.0.0.1:${port}/`);
  });
}
