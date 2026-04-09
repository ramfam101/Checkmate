import { createLogger, format, transports } from "winston";

/**
 * Dedicated logger for the escalation notification pipeline.
 * Writes every step of the escalation process to `escalations.log`.
 */

const escalationFileLogger = createLogger({
	level: "debug",
	format: format.combine(
		format.timestamp(),
		format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
	),
	transports: [
		new transports.File({ filename: "escalations.log" }),
		new transports.Console({
			format: format.combine(
				format.colorize(),
				format.printf(({ timestamp, level, message }) => `${timestamp} [ESCALATION] ${level}: ${message}`)
			),
		}),
	],
});

function fmt(obj: Record<string, unknown>): string {
	return Object.entries(obj)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(" ");
}

export const escalationLog = {
	/** Called when a new escalation is queued */
	scheduled(monitorId: string, notificationId: string, delayMs: number): void {
		escalationFileLogger.info(`SCHEDULED ${fmt({ monitorId, notificationId, delayMs })}`);
	},

	/** Called when an escalation is canceled because the monitor recovered */
	canceled(monitorId: string, notificationId: string, reason: string): void {
		escalationFileLogger.info(`CANCELED ${fmt({ monitorId, notificationId, reason })}`);
	},

	/** Called when all escalations for a monitor are bulk-canceled */
	bulkCanceled(monitorId: string, count: number): void {
		escalationFileLogger.info(`BULK_CANCELED ${fmt({ monitorId, count })}`);
	},

	/** Called when the scheduler checks if the monitor is still down */
	statusCheck(monitorId: string, teamId: string, isStillDown: boolean): void {
		escalationFileLogger.debug(`STATUS_CHECK ${fmt({ monitorId, teamId, isStillDown })}`);
	},

	/** Called when the delay has elapsed and the escalation is about to fire */
	firing(monitorId: string, notificationId: string): void {
		escalationFileLogger.info(`FIRING ${fmt({ monitorId, notificationId })}`);
	},

	/** Called when handleEscalationReady is invoked */
	callbackInvoked(monitorId: string, notificationId: string, notificationType: string): void {
		escalationFileLogger.info(`CALLBACK_INVOKED ${fmt({ monitorId, notificationId, notificationType })}`);
	},

	/** Called just before send() is executed */
	sendAttempt(monitorId: string, notificationId: string, notificationType: string): void {
		escalationFileLogger.info(`SEND_ATTEMPT ${fmt({ monitorId, notificationId, notificationType })}`);
	},

	/** Called after send() returns */
	sendResult(monitorId: string, notificationId: string, success: boolean): void {
		if (success) {
			escalationFileLogger.info(`SEND_SUCCESS ${fmt({ monitorId, notificationId })}`);
		} else {
			escalationFileLogger.warn(`SEND_FAILED ${fmt({ monitorId, notificationId })}`);
		}
	},

	/** Called when an unexpected error occurs anywhere in the escalation pipeline */
	error(monitorId: string, notificationId: string, message: string): void {
		escalationFileLogger.error(`ERROR ${fmt({ monitorId, notificationId, message })}`);
	},

	/** Called when scheduleEscalations is first invoked for a monitor */
	pipelineStart(monitorId: string, escalationNotificationCount: number): void {
		escalationFileLogger.info(`PIPELINE_START ${fmt({ monitorId, escalationNotificationCount })}`);
	},

	/** Called when no escalation-eligible notifications are found */
	noEligibleNotifications(monitorId: string, fetched: number): void {
		escalationFileLogger.info(`NO_ELIGIBLE_NOTIFICATIONS ${fmt({ monitorId, fetched })}`);
	},
};
