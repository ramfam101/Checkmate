import { z } from "zod";
import { booleanCoercion } from "./shared.js";

//****************************************
// Incident Validations
//****************************************

export const getIncidentsByTeamQueryValidation = z.object({
	sortOrder: z.enum(["asc", "desc"]),
	dateRange: z.enum(["recent", "hour", "day", "week", "month", "all"]),
	page: z.coerce.number().int().min(0),
	rowsPerPage: z.coerce.number().int().min(1),
	status: booleanCoercion.optional(),
	monitorId: z.string().optional(),
	resolutionType: z.enum(["manual", "automatic"]).optional(),
});

export const getIncidentSummaryQueryValidation = z.object({
	limit: z.coerce.number().int().min(1).optional(),
});

export const createIncidentBodyValidation = z.object({
	monitorId: z.string().min(1, "Monitor ID is required"),
	message: z.union([z.string(), z.literal("")]).optional(),
	statusCode: z.number().optional(),
});

export const editIncidentBodyValidation = z.object({
	resolutionType: z.enum(["automatic", "manual"]).optional(),
	resolvedBy: z.string().optional(),
	resolvedByEmail: z.string().email().optional(),
	comment: z.union([z.string(), z.literal("")]).optional(),
	escalationsSent: z.number().int().min(0, "Escalations sent must be non-negative").optional(),
	lastEscalationTime: z.string().datetime().optional(),
});

export const getIncidentByIdParamValidation = z.object({
	incidentId: z.string().min(1, "Incident ID is required"),
});
