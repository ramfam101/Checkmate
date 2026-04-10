import { z } from "zod";

const escalationRuleChannels = ["email", "slack", "discord", "webhook"] as const;

const escalationRuleSchema = z.object({
	type: z.enum(escalationRuleChannels),
	delayMinutes: z.number().int("Delay must be a whole number").positive("Delay must be a positive integer"),
	trigger: z.literal("escalation"),
});

type EscalationRuleFormInput = z.infer<typeof escalationRuleSchema>;
type EscalationValidationInput = {
	type: string;
	escalationRules?: EscalationRuleFormInput[];
};

const withEscalationRules = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
	schema
		.extend({
			escalationRules: z.array(escalationRuleSchema).default([]),
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

const baseSchema = z.object({
	notificationName: z
		.string()
		.min(1, "Notification name is required")
		.max(100, "Notification name must be at most 100 characters"),
});

const emailSchema = withEscalationRules(baseSchema.extend({
	type: z.literal("email"),
	address: z
		.string()
		.min(1, "Email is required")
		.email("Please enter a valid email address"),
}));

const slackSchema = withEscalationRules(baseSchema.extend({
	type: z.literal("slack"),
	address: z.string().min(1, "Webhook URL is required").url("Please enter a valid URL"),
}));

const discordSchema = withEscalationRules(baseSchema.extend({
	type: z.literal("discord"),
	address: z.string().min(1, "Webhook URL is required").url("Please enter a valid URL"),
}));

const webhookSchema = withEscalationRules(baseSchema.extend({
	type: z.literal("webhook"),
	address: z.string().min(1, "Webhook URL is required").url("Please enter a valid URL"),
}));

const pagerDutySchema = withEscalationRules(baseSchema.extend({
	type: z.literal("pager_duty"),
	address: z.string().min(1, "Integration key is required"),
}));

const matrixSchema = withEscalationRules(baseSchema.extend({
	type: z.literal("matrix"),
	homeserverUrl: z
		.string()
		.min(1, "Homeserver URL is required")
		.url("Please enter a valid URL"),
	roomId: z.string().min(1, "Room ID is required"),
	accessToken: z.string().min(1, "Access token is required"),
}));

const teamsSchema = withEscalationRules(baseSchema.extend({
	type: z.literal("teams"),
	address: z.string().min(1, "Webhook URL is required").url("Please enter a valid URL"),
}));

export const notificationSchema = z.discriminatedUnion("type", [
	emailSchema,
	slackSchema,
	discordSchema,
	webhookSchema,
	pagerDutySchema,
	matrixSchema,
	teamsSchema,
]);

export type NotificationFormInput = z.input<typeof notificationSchema>;
export type NotificationFormData = z.output<typeof notificationSchema>;
