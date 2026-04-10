import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	let version = "3.5.1";
	const clientHost = env.VITE_APP_CLIENT_HOST || "http://localhost:5173";
	const clientHostUrl = new URL(clientHost);
	const clientPort = clientHostUrl.port ? Number(clientHostUrl.port) : 5173;

	return {
		base: "/",
		plugins: [svgr(), react()],
		server: {
			host: true,
			port: clientPort,
			strictPort: true,
			proxy: {
				"/api": {
					target: env.VITE_DEV_PROXY_TARGET || "http://localhost:52345",
					changeOrigin: true,
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
