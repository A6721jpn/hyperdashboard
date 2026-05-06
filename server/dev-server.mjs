import { createServer as createViteServer } from "vite";
import { createDashboardServer } from "./server.mjs";

const port = Number(process.env.PORT || 5175);

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: {
      host: "127.0.0.1",
      port: 45975,
    },
  },
  appType: "spa",
});

const server = createDashboardServer({ vite });

server.listen(port, "127.0.0.1", () => {
  console.log(`Hypardashboard listening on http://127.0.0.1:${port}/`);
});
