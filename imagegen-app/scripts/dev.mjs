import { spawn } from "node:child_process";
import path from "node:path";

const codexCli = path.join(
  process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Roaming"),
  "npm",
  "node_modules",
  "@openai",
  "codex",
  "bin",
  "codex.js",
);

const children = [
  spawn(process.execPath, [codexCli, "app-server", "--listen", "ws://127.0.0.1:46212"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, ["server/api.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  }),
];

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
