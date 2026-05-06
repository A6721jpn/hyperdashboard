import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost",
    port: 46210,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:46211",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "localhost",
    port: 46210,
    strictPort: true,
  },
});
