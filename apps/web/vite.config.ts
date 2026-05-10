import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// We resolve @argon/shared to the source directory so type-checking runs
// against the latest source without a build step. For the production build
// Vite still bundles it normally.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@argon/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
