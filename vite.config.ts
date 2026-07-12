import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/image/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/image/api": {
        target: "http://127.0.0.1:4177",
        rewrite: (path) => path.replace(/^\/image/, "")
      },
      "/image/storage": {
        target: "http://127.0.0.1:4177",
        rewrite: (path) => path.replace(/^\/image/, "")
      },
      "/api": "http://127.0.0.1:4177",
      "/storage": "http://127.0.0.1:4177"
    }
  },
  build: {
    outDir: "dist-client"
  }
});
