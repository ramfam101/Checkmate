/**
 * Escalation Rules and Status Types
 * Defines escalation levels that trigger notifications based on incident duration
 */

/**
 * Represents an escalation that was sent
 * Tracks which escalations have already been triggered
 */
export interface EscalationSent {
	/** Index of the escalation level that was sent */
	levelIndex: number;
	/** When this escalation was sent */
	sentAt: string;
	/** Which notification ID received this escalation */
	notificationId: string;
	/** Source notification ID that owns this escalation rule */
	sourceNotificationId: string;
}
