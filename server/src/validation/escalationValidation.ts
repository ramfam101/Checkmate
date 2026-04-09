import { z } from "zod";

//****************************************
// Escalation Rule Validation
//****************************************

const escalationRuleSchema = z.object({
	level: z.number().int().min(1, "Level must be at least 1"),
	durationMinutes: z.number().min(0, "Duration must be a non-negative number"),
	notificationIds: z.array(z.string().min(1)).min(1, "At least one notification ID is required"),
	message: z.string().optional().nullable(),
});

//****************************************
// Create Escalation Policy
//****************************************

export const createEscalationPolicyBodyValidation = z.object({
	name: z.string().min(1, "Name is required"),
	monitorId: z.string().optional().nullable(),
	isActive: z.boolean().optional().default(true),
	escalationRules: z.array(escalationRuleSchema).min(1, "At least one escalation rule is required"),
});

//****************************************
// Update Escalation Policy
//****************************************

export const updateEscalationPolicyBodyValidation = z.object({
	name: z.string().min(1).optional(),
	monitorId: z.string().optional().nullable(),
	isActive: z.boolean().optional(),
	escalationRules: z.array(escalationRuleSchema).min(1).optional(),
});

export const escalationPolicyIdParamValidation = z.object({
	id: z.string().min(1, "Policy ID is required"),
});

export const monitorIdParamValidation = z.object({
	monitorId: z.string().min(1, "Monitor ID is required"),
});

export const incidentIdParamValidation = z.object({
	incidentId: z.string().min(1, "Incident ID is required"),
});
