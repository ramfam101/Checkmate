export const NotificationChannels = ["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams", "telegram"] as const;
export type NotificationChannel = (typeof NotificationChannels)[number];

export interface NotificationEscalation {
	id: string;
	delayMinutes: number; // Minutes after incident start to send this escalation
	message?: string; // Custom message for this escalation level
	enabled: boolean;
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
	escalations?: NotificationEscalation[]; // Escalation levels for this notification
	escalationEnabled?: boolean; // Whether escalation is enabled for this notification
	createdAt: string;
	updatedAt: string;
}
