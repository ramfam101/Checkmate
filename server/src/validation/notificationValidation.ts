import { z } from "zod";

const escalationRuleChannels = ["email", "slack", "discord", "webhook"] as const;

const escalationRuleValidation = z.object({
	type: z.enum(escalationRuleChannels),
	delayMinutes: z.number().int("Delay must be a whole number").positive("Delay must be a positive integer"),
	trigger: z.literal("escalation"),
});

type EscalationRuleInput = z.infer<typeof escalationRuleValidation>;
type EscalationValidationInput = {
	type: string;
	escalationRules?: EscalationRuleInput[];
};

const validateEscalationRules = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
	schema
		.extend({
			escalationRules: z.array(escalationRuleValidation).optional().default([]),
		})
		.superRefine((data, ctx) => {
			const normalizedData = data as EscalationValidationInput;
			const rules = normalizedData.escalationRules ?? [];
			if (rules.length === 0) {
				return;
			}

			if (!escalationRuleChannels.includes(normalizedData.type as (typeof escalationRuleChannels)[number])) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Escalation rules are only supported for email, slack, discord, and webhook notifications",
					path: ["escalationRules"],
				});
			}

			for (const [index, rule] of rules.entries()) {
				if (rule.type !== normalizedData.type) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Escalation rule type must match the notification type ${normalizedData.type}`,
						path: ["escalationRules", index, "type"],
					});
				}

				const previousRule = rules[index - 1];
				if (previousRule && rule.delayMinutes <= previousRule.delayMinutes) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Escalation delays must be sorted in strictly increasing order with no duplicates",
						path: ["escalationRules", index, "delayMinutes"],
					});
				}
			}
		});

//****************************************
// Notification Validations
//****************************************

export const createNotificationBodyValidation = z.discriminatedUnion("type", [
	// Email notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("email"),
		address: z.email("Please enter a valid e-mail address"),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	})),
	// Webhook notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("webhook"),
		address: z.url({ message: "Please enter a valid Webhook URL" }),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	})),
	// Slack notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("slack"),
		address: z.url({ message: "Please enter a valid Webhook URL" }),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	})),
	// Discord notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("discord"),
		address: z.url({ message: "Please enter a valid Webhook URL" }),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	})),
	// PagerDuty notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("pager_duty"),
		address: z.string().min(1, "PagerDuty integration key is required"),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	})),
	// Matrix notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("matrix"),
		address: z.union([z.string(), z.literal("")]).optional(),
		homeserverUrl: z.url({ message: "Please enter a valid Homeserver URL" }),
		roomId: z.string().min(1, "Room ID is required"),
		accessToken: z.string().min(1, "Access Token is required"),
	})),
	// Teams notification
	validateEscalationRules(z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("teams"),
		address: z.url({ message: "Please enter a valid Webhook URL" }),
	})),
]);

export const testNotificationBodyValidation = createNotificationBodyValidation;

export const deleteNotificationParamValidation = z.object({
	id: z.string().min(1, "Notification ID is required"),
});
export const getNotificationByIdParamValidation = z.object({
	id: z.string().min(1, "Notification ID is required"),
});
export const editNotificationParamValidation = z.object({
	id: z.string().min(1, "Notification ID is required"),
});

export const testAllNotificationsBodyValidation = z.object({
	monitorId: z.string().min(1, "Monitor ID is required"),
});

export const sendTestEmailBodyValidation = z.object({
	to: z.string().min(1, "To field is required"),
	systemEmailHost: z.string().optional(),
	systemEmailPort: z.number().optional(),
	systemEmailSecure: z.boolean().optional(),
	systemEmailPool: z.boolean().optional(),
	systemEmailAddress: z.string().optional(),
	systemEmailPassword: z.string().optional(),
	systemEmailUser: z.string().optional(),
	systemEmailConnectionHost: z.union([z.string(), z.literal("")]).optional(),
	systemEmailIgnoreTLS: z.boolean().optional(),
	systemEmailRequireTLS: z.boolean().optional(),
	systemEmailRejectUnauthorized: z.boolean().optional(),
	systemEmailTLSServername: z.union([z.string(), z.literal("")]).optional(),
});

export const updateNotificationsValidation = z
	.object({
		monitorIds: z.array(z.string()).min(1, "At least one monitor ID is required").max(100, "Cannot update more than 100 monitors at once"),
		notificationIds: z.array(z.string()).max(100, "Cannot specify more than 100 notification IDs at once"),
		action: z.enum(["add", "remove", "set"] as const),
	})
	.refine(
		(data) => {
			if (data.action !== "set" && data.notificationIds.length === 0) return false;
			return true;
		},
		{
			message: "Notification IDs cannot be empty unless action is 'set'",
			path: ["notificationIds"],
		}
	);
