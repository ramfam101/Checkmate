export const NotificationChannels = ["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams"] as const;
export type NotificationChannel = (typeof NotificationChannels)[number];

/**
 * Escalation rule defines when to send follow-up notifications
 * based on how long an incident has been active
 */
export interface EscalationRule {
	delayMinutes: number; // When to trigger this rule (in minutes after incident start)
	notificationIds: string[]; // Which notifications to send
}

export interface Notification {
	id: string;
	userId: string;
	teamId: string;
	type: NotificationChannel;
	notificationName: string;
	address?: string;
	phone?: string;
	homeserverUrl?: string;
	roomId?: string;
	accessToken?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Escalation policy groups notifications with timing rules
 * Allows users to define different notification groups to alert at different times
 */
export interface EscalationPolicy {
	id: string;
	teamId: string;
	name: string;
	description?: string;
	rules: EscalationRule[]; // Ordered by delayMinutes
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}
