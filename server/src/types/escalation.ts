export type EscalationHistoryStatus = "pending" | "sent" | "cancelled";

export interface EscalationHistoryEntry {
	delayMinutes: number;
	firedAt: Date | null;
	channels: string[]; // channel names sent to
	status: EscalationHistoryStatus;
}

export interface EscalationRule {
	delayMinutes: number;
	channels: string[]; // ObjectId[] of Notification channels
}
