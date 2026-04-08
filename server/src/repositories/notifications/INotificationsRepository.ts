import type { Notification } from "@/types/index.js";
export interface INotificationsRepository {
	// create
	create(notificationData: Partial<Notification>): Promise<Notification>;
	// fetch
	findById(id: string, teamId: string): Promise<Notification>;
	findNotificationsByIds(ids: string[]): Promise<Notification[]>;
	findByTeamId(teamId: string): Promise<Notification[]>;
	// update
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	updateLastReminderSent(id: string, teamId: string, timestamp: string): Promise<void>;
	// delete
	deleteById(id: string, teamId: string): Promise<Notification>;
}
