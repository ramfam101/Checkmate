export const NotificationChannels = [
	"email",
	"slack",
	"discord",
	"webhook",
	"pager_duty",
	"matrix",
	"teams",
] as const;
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
	createdAt: string;
	updatedAt: string;
}

export interface EscalationNotification {
	id: string;
	monitorId: string;
	escalationLevel: number;
	delaySeconds: number;
	notificationChannel: NotificationChannel;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}
