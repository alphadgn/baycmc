import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      buffer: path.resolve(__dirname, "node_modules/buffer/index.js"),
    },
  },
} as import("vite").UserConfig);
