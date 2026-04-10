import type { NextFunction, Request, Response } from "express";
import { logger } from "@/utils/logger.js";
import { AppError } from "@/utils/AppError.js";

const handleErrors = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
	const status = error instanceof AppError ? error.status || 500 : 500;
	const message = error instanceof AppError ? error.message : "Server error";
	const service = error instanceof AppError ? error.service : "unknownService";
	const method = error instanceof AppError ? error.method : "unknownMethod";
	logger.error({
		message: message,
		service: service,
		method: method,
		stack: error instanceof AppError ? error.stack : undefined,
		details: error instanceof AppError ? error.details : undefined,
	});
	const runtimeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
	const debugEnvs = new Set(["development", "dev", "test", "local"]);
	const shouldIncludeDetails =
		error instanceof AppError && typeof error.details !== "undefined" && debugEnvs.has(runtimeEnv) && process.env.API_ERROR_DETAILS !== "false";
	res.status(status).json({
		status,
		msg: message,
		...(shouldIncludeDetails ? { details: error.details } : {}),
	});
};

export { handleErrors };
