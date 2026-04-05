export const NotificationChannels = [
	"email",
	"slack",
	"discord",
	"webhook",
	"pager_duty",
	"matrix",
	"teams",
	"telegram",
] as const;
export type NotificationChannel = (typeof NotificationChannels)[number];

export interface NotificationEscalation {
	id: string;
	delayMinutes: number;
	message?: string;
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
	escalations?: NotificationEscalation[];
	escalationEnabled?: boolean;
	createdAt: string;
	updatedAt: string;
}
