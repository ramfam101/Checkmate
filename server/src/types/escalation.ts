export interface NotificationEscalation {
	id?: string;
	delayMinutes: number;
	channelId: string;
}

export interface NotificationEscalationTracker {
	id: string;
	incidentId: string;
	monitorId: string;
	teamId: string;
	escalationRuleId: string;
	primaryNotificationId: string;
	escalationNotificationId: string;
	delayMinutes: number;
	createdAt: string;
	escalatedAt?: string;
	acknowledgedAt?: string;
	isEscalated: boolean;
}