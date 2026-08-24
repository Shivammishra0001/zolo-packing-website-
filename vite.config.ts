import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // NOTE: viteSingleFile() was removed. It inlined every asset — including 57
  // product images — as base64 into one file, producing an 80 MB index.html
  // that every visitor downloaded in full before the page could render.
  // Emitting normal hashed assets drops the initial load to ~1.6 MB (js+css);
  // media then loads on demand and is cached by the browser and CDN.
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
