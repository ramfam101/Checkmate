/**
 * Escalation Rule Types
 * Defines how and when notifications escalate for persistent incidents
 */

export interface EscalationRule {
	delayMinutes: number;        // Minutes to wait before escalating
	notificationIds: string[];   // Notification channels to notify
}

export interface EscalationHistoryEntry {
	escalationIndex: number;     // Index in escalationRules array
	triggeredAt: Date;           // When escalation was triggered
	incidentId: string;          // ID of incident that triggered it
}
