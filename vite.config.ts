import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_TARGET || "http://127.0.0.1:4177";

export default defineConfig({
  base: "/image/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/image/api": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/image/, "")
      },
      "/image/storage": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/image/, "")
      },
      "/api": apiTarget,
      "/storage": apiTarget
    }
  },
  build: {
    outDir: "dist-client"
  }
});
