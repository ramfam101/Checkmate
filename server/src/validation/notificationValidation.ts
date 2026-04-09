import { z } from "zod";

//****************************************
// Notification Validations
//****************************************

const alertTimesValidation = z
	.array(z.number().int().min(1, "Alert times must be at least 1 minute").max(10080, "Alert times must be at most 10080 minutes"))
	.max(20, "Cannot configure more than 20 alert times")
	.refine((times) => new Set(times).size === times.length, {
		message: "Alert times must be unique",
	})
	.optional();

export const createNotificationBodyValidation = z.discriminatedUnion("type", [
	// Email notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("email"),
		alertTimes: alertTimesValidation,
		address: z.email("Please enter a valid e-mail address"),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	}),
	// Webhook notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("webhook"),
		alertTimes: alertTimesValidation,
		address: z.url({ message: "Please enter a valid Webhook URL" }),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	}),
	// Slack notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("slack"),
		alertTimes: alertTimesValidation,
		address: z.url({ message: "Please enter a valid Webhook URL" }),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	}),
	// Discord notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("discord"),
		alertTimes: alertTimesValidation,
		address: z.url({ message: "Please enter a valid Webhook URL" }),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	}),
	// PagerDuty notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("pager_duty"),
		alertTimes: alertTimesValidation,
		address: z.string().min(1, "PagerDuty integration key is required"),
		homeserverUrl: z.union([z.string(), z.literal("")]).optional(),
		roomId: z.union([z.string(), z.literal("")]).optional(),
		accessToken: z.union([z.string(), z.literal("")]).optional(),
	}),
	// Matrix notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("matrix"),
		alertTimes: alertTimesValidation,
		address: z.union([z.string(), z.literal("")]).optional(),
		homeserverUrl: z.url({ message: "Please enter a valid Homeserver URL" }),
		roomId: z.string().min(1, "Room ID is required"),
		accessToken: z.string().min(1, "Access Token is required"),
	}),
	// Teams notification
	z.object({
		notificationName: z.string().min(1, "Notification name is required"),
		type: z.literal("teams"),
		alertTimes: alertTimesValidation,
		address: z.url({ message: "Please enter a valid Webhook URL" }),
	}),
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
	systemEmailPort: z.coerce.number().optional(),
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
