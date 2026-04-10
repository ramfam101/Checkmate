import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import swaggerUi, { type JsonObject } from "swagger-ui-express";
import { handleErrors } from "@/middleware/handleErrors.js";
import { generalApiLimiter } from "@/middleware/rateLimiter.js";
import { sanitizeBody, sanitizeQuery } from "@/middleware/sanitization.js";
import { setupRoutes } from "@/config/routes.js";
import { InitializedServices } from "@/config/services.js";
import { InitializedControllers } from "@/config/controllers.js";
import { EnvConfig } from "@/service/system/settingsService.js";

export const createApp = ({
	services,
	controllers,
	envSettings,
	frontendPath,
	openApiSpec,
}: {
	services: InitializedServices;
	controllers: InitializedControllers;
	envSettings: EnvConfig;
	frontendPath: string;
	openApiSpec: JsonObject;
}) => {
	const allowedOrigins = new Set<string>([envSettings.clientHost]);
	const frontendIndexPath = path.join(frontendPath, "index.html");
	const hasFrontendBuild = fs.existsSync(frontendIndexPath);
	try {
		const clientHostUrl = new URL(envSettings.clientHost);
		if (envSettings.nodeEnv === "development") {
			const port = clientHostUrl.port ? `:${clientHostUrl.port}` : "";
			allowedOrigins.add(`${clientHostUrl.protocol}//localhost${port}`);
			allowedOrigins.add(`${clientHostUrl.protocol}//127.0.0.1${port}`);
		}
	} catch {
		// If clientHost is malformed, env validation will already fail before runtime.
	}
	const app = express();

	app.use(generalApiLimiter);

	app.use(
		cors({
			origin: (origin, callback) => {
				if (!origin || allowedOrigins.has(origin)) {
					callback(null, true);
					return;
				}
				callback(null, false);
			},
			methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
			allowedHeaders: ["Content-Type", "Authorization", "Accept-Language"],
			credentials: true,
		})
	);

	if (hasFrontendBuild) {
		app.use(express.static(frontendPath));
	}

	app.use(express.json());
	app.use(cookieParser());

	app.use(sanitizeBody());
	app.use(sanitizeQuery());

	app.use(
		helmet({
			hsts: false,
			contentSecurityPolicy: {
				useDefaults: true,
				directives: {
					upgradeInsecureRequests: null,
					"script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
					"object-src": ["'none'"],
					"base-uri": ["'self'"],
				},
			},
		})
	);
	app.use(
		compression({
			level: 6,
			threshold: 1024,
			filter: (req, res) => {
				if (req.headers["x-no-compression"]) {
					return false;
				}
				return compression.filter(req, res);
			},
		})
	);
	// Swagger UI — dynamically set server URL from request
	app.use("/api-docs", swaggerUi.serve, (req: express.Request, res: express.Response, next: express.NextFunction) => {
		const protocol = req.protocol;
		const host = req.get("host");
		const dynamicSpec = {
			...openApiSpec,
			servers: [
				{
					url: `${protocol}://${host}/api/v1`,
					description: "Current Server",
				},
				...openApiSpec.servers,
			],
		};
		swaggerUi.setup(dynamicSpec)(req, res, next);
	});

	app.use("/api/v1/health", (req, res) => {
		res.json({
			status: "OK",
		});
	});

	// Main app routes
	setupRoutes(app, controllers, services);

	// FE routes
	app.get("*", (req, res) => {
		if (req.path.startsWith("/api/")) {
			res.status(404).json({
				status: 404,
				msg: "Route not found",
			});
			return;
		}

		if (hasFrontendBuild) {
			res.sendFile(frontendIndexPath);
			return;
		}

		if (envSettings.nodeEnv === "development") {
			const redirectUrl = new URL(req.originalUrl, envSettings.clientHost).toString();
			res.redirect(302, redirectUrl);
			return;
		}

		res.status(503).json({
			status: 503,
			msg: "Frontend build is not available on this server",
		});
	});
	app.use(handleErrors);
	return app;
};
