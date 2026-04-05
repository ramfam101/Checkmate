import type { NotificationHistory } from "@/db/models/NotificationHistory.js";

export interface INotificationHistoryRepository {
	// create
	create(historyData: Omit<NotificationHistory, "id">): Promise<NotificationHistory>;
	// fetch
	findByIncidentId(incidentId: string): Promise<NotificationHistory[]>;
	findByIncidentAndNotification(incidentId: string, notificationId: string): Promise<NotificationHistory[]>;
	findByIncidentAndEscalation(incidentId: string, escalationId: string): Promise<NotificationHistory | null>;
	// delete (for cleanup)
	deleteByIncidentId(incidentId: string): Promise<void>;
}