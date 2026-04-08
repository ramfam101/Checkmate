import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  let version = "3.5.1";

  return {
    base: "/",
    plugins: [svgr(), react()],
    server: {
      host: true,
      proxy: {
        "/auth": {
          target: "http://localhost:52345",
          changeOrigin: true,
          rewrite: (path) => `/api/v1${path}`,
        },
        "/settings": {
          target: "http://localhost:52345",
          changeOrigin: true,
          rewrite: (path) => `/api/v1${path}`,
        },
        "/notifications": {
          target: "http://localhost:52345",
          changeOrigin: true,
          rewrite: (path) => `/api/v1${path}`,
        },
        "/monitors": {
          target: "http://localhost:52345",
          changeOrigin: true,
          rewrite: (path) => `/api/v1${path}`,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    optimizeDeps: {
      include: ["@mui/material/Tooltip", "@emotion/styled"],
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
  };
});