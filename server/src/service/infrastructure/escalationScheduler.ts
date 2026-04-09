import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import { IMonitorsRepository } from "@/repositories/index.js";
import { ILogger } from "@/utils/logger.js";
import { escalationLog } from "@/utils/escalationLogger.js";

const SERVICE_NAME = "EscalationScheduler";

export interface IEscalationScheduler {
	scheduleEscalation: (
		notification: Notification,
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		delayMs: number,
		onReady: (context: EscalationContext) => Promise<void>
	) => Promise<void>;
	cancelEscalations: (monitorId: string) => Promise<void>;
	isMonitorStillDown: (monitorId: string, teamId: string) => Promise<boolean>;
}

export interface EscalationContext {
	notification: Notification;
	monitor: Monitor;
	monitorStatusResponse: MonitorStatusResponse;
	decision: MonitorActionDecision;
}

interface PendingEscalation {
	timeoutId: NodeJS.Timeout;
	monitorId: string;
	teamId: string;
	notificationId: string;
}

export class EscalationScheduler implements IEscalationScheduler {
	static SERVICE_NAME = SERVICE_NAME;

	private monitorsRepository: IMonitorsRepository;
	private logger: ILogger;
	private pendingEscalations: Map<string, PendingEscalation> = new Map();

	constructor(monitorsRepository: IMonitorsRepository, logger: ILogger) {
		this.monitorsRepository = monitorsRepository;
		this.logger = logger;
	}

	/**
	 * Schedule a notification to be sent after a delay
	 * Generates a unique key based on monitorId and notificationId
	 * Calls the onReady callback when escalation should be sent (after delay and monitor still down)
	 */
	scheduleEscalation = async (
		notification: Notification,
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		delayMs: number,
		onReady: (context: EscalationContext) => Promise<void>
	): Promise<void> => {
		const escalationKey = `${monitor.id}:${notification.id}`;

		// Cancel any existing escalation for this combination
		await this.cancelEscalation(escalationKey);

		// Create callback that will be executed after delay
		const executeEscalation = async () => {
			try {
				// Check if monitor is still down
				const isStillDown = await this.isMonitorStillDown(monitor.id, monitor.teamId);
				escalationLog.statusCheck(monitor.id, monitor.teamId, isStillDown);

				if (!isStillDown) {
					this.logger.info({
						message: `Monitor ${monitor.id} recovered before escalation was sent, skipping notification ${notification.id}`,
						service: SERVICE_NAME,
						method: "executeEscalation",
					});
					escalationLog.canceled(monitor.id, notification.id, "monitor_recovered_before_delay_elapsed");
					this.pendingEscalations.delete(escalationKey);
					return;
				}

				this.logger.info({
					message: `Escalation ready to send for monitor ${monitor.id}, notification ${notification.id}`,
					service: SERVICE_NAME,
					method: "executeEscalation",
				});
				escalationLog.firing(monitor.id, notification.id);

				// Call the callback to actually send the notification
				const context: EscalationContext = {
					notification,
					monitor,
					monitorStatusResponse,
					decision,
				};

				await onReady(context);

				// Remove from pending after successful send
				this.pendingEscalations.delete(escalationKey);
			} catch (error: unknown) {
				const errMsg = error instanceof Error ? error.message : "Unknown error";
				this.logger.error({
					message: `Error executing escalation for monitor ${monitor.id}: ${errMsg}`,
					service: SERVICE_NAME,
					method: "executeEscalation",
					stack: error instanceof Error ? error.stack : undefined,
				});
				escalationLog.error(monitor.id, notification.id, errMsg);
				this.pendingEscalations.delete(escalationKey);
			}
		};

		// Schedule the callback
		const timeoutId = setTimeout(executeEscalation, delayMs);

		const pendingEscalation: PendingEscalation = {
			timeoutId,
			monitorId: monitor.id,
			teamId: monitor.teamId,
			notificationId: notification.id,
		};

		this.pendingEscalations.set(escalationKey, pendingEscalation);
		escalationLog.scheduled(monitor.id, notification.id, delayMs);

		this.logger.info({
			message: `Escalation scheduled for monitor ${monitor.id}, notification ${notification.id} in ${delayMs}ms`,
			service: SERVICE_NAME,
			method: "scheduleEscalation",
		});
	};

	/**
	 * Cancel a specific escalation by key
	 */
	private cancelEscalation = async (escalationKey: string): Promise<void> => {
		const pending = this.pendingEscalations.get(escalationKey);
		if (pending) {
			clearTimeout(pending.timeoutId);
			this.pendingEscalations.delete(escalationKey);
			this.logger.debug({
				message: `Escalation canceled for monitor ${pending.monitorId}, notification ${pending.notificationId}`,
				service: SERVICE_NAME,
				method: "cancelEscalation",
			});
		}
	};

	/**
	 * Cancel all escalations for a monitor (called when monitor recovers)
	 */
	cancelEscalations = async (monitorId: string): Promise<void> => {
		const keysToDelete: string[] = [];

		// Find all escalations for this monitor
		for (const [key, pending] of this.pendingEscalations.entries()) {
			if (pending.monitorId === monitorId) {
				clearTimeout(pending.timeoutId);
				keysToDelete.push(key);
			}
		}

		// Delete them
		keysToDelete.forEach((key) => {
			this.pendingEscalations.delete(key);
		});

		if (keysToDelete.length > 0) {
			escalationLog.bulkCanceled(monitorId, keysToDelete.length);
			this.logger.debug({
				message: `Canceled ${keysToDelete.length} escalations for monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: "cancelEscalations",
			});
		}
	};

	/**
	 * Check if a monitor is currently in "down" status
	 */
	isMonitorStillDown = async (monitorId: string, teamId: string = ""): Promise<boolean> => {
		try {
			const monitor = await this.monitorsRepository.findById(monitorId, teamId);
			if (!monitor) {
				return false;
			}
			return monitor.status === "down";
		} catch (error: unknown) {
			this.logger.error({
				message: `Error checking monitor status for ${monitorId}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "isMonitorStillDown",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
	};
}
