const SERVICE_NAME = "EscalationService";

import type { Monitor, EscalationRule } from "@/types/index.js";
import type { INotificationsService } from "./notificationsService.js";
import type { ILogger } from "@/utils/logger.js";

export interface IEscalationService {
	readonly serviceName: string;
	scheduleEscalation(monitor: Monitor, incidentId: string): Promise<void>;
	cancelEscalation(monitorId: string): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	readonly serviceName = SERVICE_NAME;

	private logger: ILogger;
	private notificationsService: INotificationsService;
	private scheduledTimeouts: Map<string, NodeJS.Timeout> = new Map();

	constructor(logger: ILogger, notificationsService: INotificationsService) {
		this.logger = logger;
		this.notificationsService = notificationsService;
	}

	scheduleEscalation = async (monitor: Monitor, incidentId: string): Promise<void> => {
		// Cancel any existing escalation for this monitor
		await this.cancelEscalation(monitor.id);

		if (!monitor.escalationRules || monitor.escalationRules.length === 0) {
			return;
		}

		for (const rule of monitor.escalationRules) {
			const timeoutId = setTimeout(async () => {
				try {
					// Check if incident is still active
					// For now, we'll send the escalation notification
					// In a real implementation, you'd check if the incident is still active
					await this.sendEscalationNotification(monitor, rule);
				} catch (error) {
					this.logger.error({
						message: `Failed to send escalation notification`,
						service: SERVICE_NAME,
						method: "scheduleEscalation",
						details: { monitorId: monitor.id, incidentId },
						stack: error instanceof Error ? error.stack : undefined,
					});
				} finally {
					// Remove the timeout from the map
					this.scheduledTimeouts.delete(`${monitor.id}-${rule.delayMinutes}`);
				}
			}, rule.delayMinutes * 60 * 1000); // Convert minutes to milliseconds

			this.scheduledTimeouts.set(`${monitor.id}-${rule.delayMinutes}`, timeoutId);
		}

		this.logger.info({
			message: `Scheduled ${monitor.escalationRules.length} escalation notifications for monitor ${monitor.id}`,
			service: SERVICE_NAME,
			method: "scheduleEscalation",
			details: { monitorId: monitor.id, incidentId },
		});
	};

	cancelEscalation = async (monitorId: string): Promise<void> => {
		const keysToDelete: string[] = [];
		for (const [key, timeoutId] of this.scheduledTimeouts.entries()) {
			if (key.startsWith(`${monitorId}-`)) {
				clearTimeout(timeoutId);
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.scheduledTimeouts.delete(key);
		}

		if (keysToDelete.length > 0) {
			this.logger.info({
				message: `Cancelled ${keysToDelete.length} escalation notifications for monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: "cancelEscalation",
				details: { monitorId },
			});
		}
	};

	private sendEscalationNotification = async (monitor: Monitor, rule: EscalationRule): Promise<void> => {
		// For escalation, we send a notification with a special message indicating it's an escalation
		const escalationMessage = {
			monitor,
			decision: {
				shouldSendNotification: true,
				incidentReason: "escalation",
			} as any,
			monitorStatusResponse: undefined,
		};

		// Send only to the specific notification channel
		const notifications = await this.notificationsService.findNotificationsByTeamId(monitor.teamId);
		const targetNotification = notifications.find(n => n.id === rule.notificationId);

		if (targetNotification) {
			await this.notificationsService.sendTestNotification(targetNotification);
		}
	};
}