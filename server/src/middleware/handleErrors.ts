import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "@/utils/logger.js";
import { AppError } from "@/utils/AppError.js";

const handleErrors = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
	const isZodError = error instanceof ZodError;
	const status = error instanceof AppError ? error.status || 500 : isZodError ? 400 : 500;
	const message = error instanceof AppError ? error.message : isZodError ? "Validation failed" : "Server error";
	const service = error instanceof AppError ? error.service : "unknownService";
	const method = error instanceof AppError ? error.method : "unknownMethod";
	logger.error({
		message: message,
		service: service,
		method: method,
		stack: error instanceof AppError ? error.stack : undefined,
		details: error instanceof AppError ? error.details : isZodError ? error.format() : undefined,
	});
	res.status(status).json({
		status,
		msg: message,
		errors: isZodError ? error.format() : undefined,
		details: error instanceof AppError ? error.details : undefined,
	});
};

export { handleErrors };
