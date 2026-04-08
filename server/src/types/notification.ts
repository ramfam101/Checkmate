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
	// Reminder settings for ongoing incidents
	reminderInterval?: number; // Interval in minutes between reminders (0 = disabled)
	lastReminderSent?: string; // ISO timestamp of last reminder
	createdAt: string;
	updatedAt: string;
}
