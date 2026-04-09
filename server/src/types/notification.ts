export const NotificationChannels = ["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams"] as const;
export type NotificationChannel = (typeof NotificationChannels)[number];

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
	// Escalation notification fields
	isEscalation?: boolean;        // false for user-configured, true for system-triggered escalations
	escalationLevel?: number;      // 1, 2, 3... for escalation sequence
	incidentId?: string;           // links to the incident that triggered escalation
	monitorId?: string;            // monitor that triggered the escalation
	createdAt: string;
	updatedAt: string;
}
