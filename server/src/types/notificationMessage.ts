export type NotificationType = "monitor_down" | "monitor_up" | "threshold_breach" | "threshold_resolved" | "escalation" | "test";

export type NotificationSeverity = "critical" | "warning" | "info" | "success";

export interface MonitorInfo {
	id: string;
	name: string;
	url: string;
	type: string;
	status: string;
}

export interface ThresholdBreach {
	metric: "cpu" | "memory" | "disk" | "temp";
	currentValue: number;
	threshold: number;
	unit: string;
	formattedValue: string;
}

export interface IncidentInfo {
	id: string;
	url: string;
	createdAt: Date;
	resolvedAt?: Date;
	duration?: string;
}

export interface NotificationContent {
	title: string;
	summary: string;
	details?: string[];
	thresholds?: ThresholdBreach[];
	incident?: IncidentInfo;
	timestamp: Date;
}

export interface NotificationMessage {
	type: NotificationType;
	severity: NotificationSeverity;
	monitor: MonitorInfo;
	content: NotificationContent;
	clientHost: string;
	metadata: {
		teamId: string;
		notificationReason: string;
	};
}
