# Hypardashboard Chat App

Standalone local brainstorming chat app for Codex App Server.

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:5174/`.

For UI-only testing without calling Codex:

```powershell
npm run dev:mock
```

## Codex App Server integration

The browser talks to this app's local Node server. The Node server starts `codex app-server` over the official default `stdio://` transport, sends JSON-RPC messages, and streams turn notifications back to the browser as newline-delimited JSON.

The core sequence is:

1. `initialize`
2. `initialized`
3. `model/list`
4. `thread/start` or reuse the saved `codexThreadId`
5. `turn/start`
6. stream `item/agentMessage/delta`, `item/completed`, and `turn/completed`
