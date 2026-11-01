import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: "../plugins/agent-fleet/assets/dashboard", emptyOutDir: true },
  server: { port: 4601, strictPort: true, proxy: { "/api": "http://127.0.0.1:4600" } },
});
