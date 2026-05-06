import { createServer as createViteServer } from "vite";
import { createChatServer } from "./server.mjs";

const port = Number(process.env.PORT || 5174);

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});

const server = await createChatServer({ vite });

server.listen(port, "localhost", () => {
  console.log(`Hypardashboard Chat App listening on http://localhost:${port}/`);
  if (process.env.CHAT_APP_MOCK_CODEX === "1") {
    console.log("CHAT_APP_MOCK_CODEX=1, using local mock Codex responses.");
  }
});
