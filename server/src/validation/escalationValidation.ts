import { z } from "zod";

//****************************************
// Escalation Rule Validations
//****************************************

export const escalationRuleBodyValidation = z.object({
	delayMinutes: z.number().min(1, "Delay must be at least 1 minute"),
	channels: z.array(z.string().min(1, "Channel ID is required")).min(1, "At least one channel is required"),
});

export const escalationRulesBodyValidation = z.array(escalationRuleBodyValidation).optional().default([]);
