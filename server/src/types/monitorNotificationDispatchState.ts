export interface MonitorNotificationDispatchState {
    id: string;
    userId: string;
    teamId: string;
    monitorId: string;
    notificationId: string;
    lastSentAt: string | null;
    createdAt: string;
    updatedAt: string;
}