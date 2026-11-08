import { defineConfig } from "vite-plus";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  base: "./",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/core"] },
  worker: { format: "es" },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
