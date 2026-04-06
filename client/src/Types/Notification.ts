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
	escalationRules?: {
		id?: string;
		afterMinutes: number;
		notificationId?: string; // optional target notification id (if set, escalation will send to that channel)
	}[];
	createdAt: string;
	updatedAt: string;
}
