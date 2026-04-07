import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/AppError.js";
import type { ILogger } from "@/utils/logger.js";

export const createHandleErrors = (logger: ILogger) => {
	return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
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
		res.status(status).json({
			status,
			msg: message,
		});
	};
};
