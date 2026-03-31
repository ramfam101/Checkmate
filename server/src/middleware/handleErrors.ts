import type { NextFunction, Request, Response } from "express";
import { logger } from "@/utils/logger.js";
import { AppError } from "@/utils/AppError.js";
import { ZodError } from "zod";

const handleErrors = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
	const isAppError = error instanceof AppError;
	const isZodError = error instanceof ZodError;
	const status = isAppError ? error.status || 500 : isZodError ? 400 : 500;
	const message = isAppError ? error.message : isZodError ? "Validation error" : "Server error";
	const service = isAppError ? error.service : isZodError ? "Validation" : "unknownService";
	const method = isAppError ? error.method : isZodError ? `${req.method} ${req.originalUrl}` : "unknownMethod";
	logger.error({
		message: message,
		service: service,
		method: method,
		stack: isAppError ? error.stack : undefined,
		details: isAppError ? error.details : isZodError ? error.flatten() : undefined,
	});
	res.status(status).json({
		status,
		msg: message,
		...(isZodError ? { errors: error.flatten() } : {}),
	});
};

export { handleErrors };
