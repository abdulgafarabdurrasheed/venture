import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const faviconSrc = path.resolve(__dirname, "../imgs/favicon.png");
const faviconDest = path.resolve(__dirname, "public/favicon.png");

function syncFavicon() {
  fs.mkdirSync(path.dirname(faviconDest), { recursive: true });
  fs.copyFileSync(faviconSrc, faviconDest);
}

function faviconPlugin() {
  return {
    name: "sync-favicon",
    buildStart() {
      syncFavicon();
    },
    configureServer() {
      syncFavicon();
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const apiPort = env.PORT || "3001";
  const devPort = Number(env.VITE_DEV_PORT || 5174);
  const apiTarget = `http://127.0.0.1:${apiPort}`;

  return {
    plugins: [react(), faviconPlugin()],
    publicDir: "public",
    resolve: {
      alias: {
        "@assets": path.resolve(__dirname, "../imgs"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/auth": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/uploads": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
