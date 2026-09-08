import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api is proxied in dev so there is no CORS preflight while developing.
// For production, `npm run build` and serve dist/ from the same origin.
export default defineConfig({
  plugins: [react()],
  // Served under /analytics/ behind nginx, alongside the main admin portal on
  // the same origin/port — asset URLs need this prefix or they resolve to the
  // portal's own root instead. Dev server still runs at the true root.
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_TARGET || "http://localhost:5001",
        changeOrigin: true,
      },
    },
  },
});
