import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { UserConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
} as UserConfig);
