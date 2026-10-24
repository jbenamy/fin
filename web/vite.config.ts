import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The app is served by Express from dist/web. `pnpm dev:web` runs Vite with the API proxied to `pnpm dev` (port 3000).
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "../dist/web", emptyOutDir: true, target: "es2022" },
  server: { proxy: { "/api": "http://localhost:3000" } },
});
