export interface EscalationRule {
	delayMinutes: number;
	channels: string[]; // Array of Notification channel IDs
}

export interface EscalationHistoryEntry {
	delayMinutes: number;
	firedAt: string;
	channels: string[];
	status: "sent" | "pending" | "cancelled" | "failed";
}
