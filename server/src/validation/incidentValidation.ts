import { z } from "zod";
import { booleanCoercion } from "./shared.js";

//****************************************
// Incident Validations
//****************************************

export const getIncidentsByTeamQueryValidation = z.object({
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	dateRange: z.enum(["recent", "hour", "day", "week", "month", "all"]).default("recent"),
	page: z.coerce.number().int().min(0).default(0),
	rowsPerPage: z.coerce.number().int().min(1).default(20),
	status: booleanCoercion.optional(),
	monitorId: z.string().optional(),
	resolutionType: z.enum(["manual", "automatic"]).optional(),
});

export const getIncidentSummaryQueryValidation = z.object({
	limit: z.coerce.number().int().min(1).optional(),
});
