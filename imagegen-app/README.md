# Codex Imagegen App

Local URL:

```powershell
http://localhost:46210/
```

Run it with:

```powershell
npm run dev
```

API:

- Browser app: `http://localhost:46210/`
- Local API: `http://localhost:46211/`
- Codex App Server websocket: `ws://127.0.0.1:46212`
- `POST /api/imagegen` starts a Codex App Server thread and waits for `imageGeneration` items.
- Generated PNGs are saved under `public/generated/` and returned to the browser as `/generated/*.png`.
- `GET /api/codex/tokens` returns the latest Codex account rate-limit data observed from App Server notifications.

This app does not call the OpenAI Images API directly and does not fabricate fallback images.

Port policy:

- This app owns `46210`.
- This app's API owns `46211`.
- This app's Codex App Server owns `46212`.
- `strictPort` is enabled, so Vite fails fast if another local app is already using the port.
- Keep future browser apps on their own fixed `46xxx` ports to avoid silent URL collisions.
