import { z } from "zod";

//****************************************
// Escalation Notification Validations
//****************************************

export const createEscalationNotificationBodyValidation = z.object({
	monitorId: z.string().min(1, "Monitor ID is required"),
	escalationLevel: z.number().int().min(1, "Escalation level must be at least 1"),
	delaySeconds: z.number().int().min(0, "Delay seconds must be non-negative"),
	notificationChannel: z.enum(["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams"]),
	isActive: z.boolean().optional().default(true),
});

export const getEscalationNotificationsByMonitorIdParamValidation = z.object({
	monitorId: z.string().min(1, "Monitor ID is required"),
});

export const deleteEscalationNotificationParamValidation = z.object({
	id: z.string().min(1, "Escalation notification ID is required"),
});

export const getEscalationNotificationByIdParamValidation = z.object({
	id: z.string().min(1, "Escalation notification ID is required"),
});

export const editEscalationNotificationParamValidation = z.object({
	id: z.string().min(1, "Escalation notification ID is required"),
});

export const editEscalationNotificationBodyValidation = z.object({
	escalationLevel: z.number().int().min(1, "Escalation level must be at least 1").optional(),
	delaySeconds: z.number().int().min(0, "Delay seconds must be non-negative").optional(),
	notificationChannel: z.enum(["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams"]).optional(),
	isActive: z.boolean().optional(),
});