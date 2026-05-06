# Hypardashboard

Hypardashboard is a local control surface for the three prototype apps in this repository:

- `imagegen-app`
- `chat-app`
- `slide-builder`

It recreates the earlier Command Center mockup as a working React prototype backed by a Node local controller. From one screen you can start, stop, restart, open, health-check, and inspect logs for each registered app.

## Getting Started

Install dependencies:

```powershell
npm install
```

Start the dashboard and its controller API:

```powershell
npm run dev
```

Open `http://127.0.0.1:5175/`.

The dashboard only runs registered commands from `server/server.mjs`. It does not expose an arbitrary shell command input.

Build for production:

```powershell
npm run build
```

Serve the built dashboard with the same controller API:

```powershell
npm run serve
```
