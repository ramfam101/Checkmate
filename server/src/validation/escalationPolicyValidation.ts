import { z } from "zod";

// Validation for escalation rules
const escalationRuleValidation = z.object({
	delayMinutes: z
		.number()
		.int()
		.positive("Delay must be a positive number")
		.min(1, "Minimum delay is 1 minute")
		.max(10080, "Maximum delay is 7 days (10080 minutes)"),
	notificationIds: z
		.array(z.string().min(1, "Invalid notification ID"))
		.min(1, "At least one notification must be specified for each rule"),
});

// Validation for creating escalation policies
export const createEscalationPolicyValidation = z
	.object({
		name: z
			.string()
			.min(1, "Name is required")
			.max(100, "Name cannot exceed 100 characters"),
		description: z.string().max(500, "Description cannot exceed 500 characters").optional(),
		rules: z.array(escalationRuleValidation).min(1, "At least one escalation rule is required"),
		enabled: z.boolean().default(true),
	})
	.refine((data) => {
		// Ensure rules are in ascending order and no duplicates
		const delayTimes = data.rules.map((r) => r.delayMinutes);
		const hasDuplicates = new Set(delayTimes).size !== delayTimes.length;
		return !hasDuplicates;
	}, "Duplicate delay times are not allowed; each rule must have a unique delay");

// Validation for updating escalation policies
export const updateEscalationPolicyValidation = z
	.object({
		name: z
			.string()
			.min(1, "Name is required")
			.max(100, "Name cannot exceed 100 characters")
			.optional(),
		description: z.string().max(500, "Description cannot exceed 500 characters").optional(),
		rules: z.array(escalationRuleValidation).optional(),
		enabled: z.boolean().optional(),
	})
	.refine((data) => {
		if (!data.rules) {
			return true;
		}
		const delayTimes = data.rules.map((r) => r.delayMinutes);
		const hasDuplicates = new Set(delayTimes).size !== delayTimes.length;
		return !hasDuplicates;
	}, "Duplicate delay times are not allowed; each rule must have a unique delay");

// Validation for getting escalation policies by team ID
export const getEscalationPoliciesQueryValidation = z.object({
	teamId: z.string().min(1, "Team ID is required"),
	enabled: z.boolean().optional(),
});

// Validation for getting a specific escalation policy
export const getEscalationPolicyParamValidation = z.object({
	policyId: z.string().min(1, "Policy ID is required"),
});

// Validation for deleting an escalation policy
export const deleteEscalationPolicyParamValidation = z.object({
	policyId: z.string().min(1, "Policy ID is required"),
});
