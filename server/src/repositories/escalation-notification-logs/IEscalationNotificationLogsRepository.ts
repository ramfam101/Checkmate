interface EscalationNotificationLog {
	id: string;
	incidentId: string;
	escalationNotificationId: string;
	sentAt: Date;
	notificationChannel: string;
	status: "sent" | "failed";
	errorMessage?: string;
}

export interface IEscalationNotificationLogsRepository {
	create(logData: Omit<EscalationNotificationLog, "id">): Promise<EscalationNotificationLog>;
	hasBeenSent(incidentId: string, escalationNotificationId: string): Promise<boolean>;
}