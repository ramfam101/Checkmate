import Joi from "joi";

export const createEscalationPolicySchema = Joi.object({
	name: Joi.string().min(1).max(100).required().messages({
		"string.empty": "Policy name is required",
		"string.max": "Policy name must be less than 100 characters",
	}),
	description: Joi.string().max(500).optional().allow(""),
	rules: Joi.array()
		.min(1)
		.required()
		.items(
			Joi.object({
				delayMinutes: Joi.number().integer().min(1).max(10080).required().messages({
					"number.min": "Delay must be at least 1 minute",
					"number.max": "Delay cannot exceed 10080 minutes (7 days)",
				}),
				notificationIds: Joi.array().min(1).required().items(Joi.string()).messages({
					"array.min": "Each rule must have at least one notification",
				}),
			})
		)
		.messages({
			"array.min": "At least one escalation rule is required",
		}),
	enabled: Joi.boolean().required(),
});
