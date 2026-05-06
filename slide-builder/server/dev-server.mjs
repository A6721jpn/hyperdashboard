import { createServer as createViteServer } from "vite";
import { createSlideBuilderServer } from "./server.mjs";

const port = Number(process.env.PORT || 46310);

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: {
      host: "localhost",
      port: 46311,
    },
  },
  appType: "spa",
});

const server = await createSlideBuilderServer({ vite });

server.listen(port, "localhost", () => {
  console.log(`Slide Builder listening on http://localhost:${port}/`);
  if (process.env.SLIDE_BUILDER_MOCK_CODEX === "1") {
    console.log("SLIDE_BUILDER_MOCK_CODEX=1, using local mock Codex responses.");
  }
});
