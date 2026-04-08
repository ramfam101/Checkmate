import type { Monitor, Escalation } from "@/types/monitor.js";
import type { Incident } from "@/types/incident.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import type { INotificationsService } from "@/service/index.js";
import type { IMonitorsRepository } from "@/repositories/index.js";
import type { ILogger } from "@/utils/logger.js";

const SERVICE_NAME = "EscalationService";

export interface IEscalationService {
	processEscalations(monitor: Monitor, incident: Incident, monitorStatusResponse: MonitorStatusResponse): Promise<Escalation[]>;
	resetEscalations(monitorId: string, teamId: string): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private notificationsService: INotificationsService;
	private monitorsRepository: IMonitorsRepository;

	constructor(logger: ILogger, notificationsService: INotificationsService, monitorsRepository: IMonitorsRepository) {
		this.logger = logger;
		this.notificationsService = notificationsService;
		this.monitorsRepository = monitorsRepository;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	/**
	 * Process escalations for a monitor that's currently in an incident
	 * Checks which escalations should fire based on incident duration
	 * Sends notifications for escalations that haven't been sent yet
	 * @param monitor - The monitor with escalations configured
	 * @param incident - The active incident
	 * @param monitorStatusResponse - Current monitor status for notification context
	 * @returns Array of escalations that were processed (sent)
	 */
	processEscalations = async (monitor: Monitor, incident: Incident, monitorStatusResponse: MonitorStatusResponse): Promise<Escalation[]> => {
		const escalations = monitor.escalations || [];

		if (escalations.length === 0) {
			return [];
		}

		// Calculate how long the incident has been active (in minutes)
		const incidentStartTime = new Date(incident.startTime).getTime();
		const now = Date.now();
		const incidentDurationMinutes = (now - incidentStartTime) / (60 * 1000);

		const processedEscalations: Escalation[] = [];

		for (const escalation of escalations) {
			// Skip if already sent
			if (escalation.isSent) {
				this.logger.debug({
					message: `Escalation already sent for monitor ${monitor.id} at ${escalation.delayMinutes} min delay`,
					service: SERVICE_NAME,
					method: "processEscalations",
				});
				continue;
			}

			// Check if enough time has passed for this escalation
			if (incidentDurationMinutes >= escalation.delayMinutes) {
				try {
					this.logger.info({
						message: `Firing escalation for monitor ${monitor.id} after ${escalation.delayMinutes} minutes`,
						service: SERVICE_NAME,
						method: "processEscalations",
					});

					// Send the escalation notification
					const success = await this.notificationsService.sendEscalationNotification(monitor, escalation.notificationId, monitorStatusResponse);

					if (success) {
						// Mark escalation as sent only if send succeeded
						await this.monitorsRepository.updateEscalationSent(monitor.id, monitor.teamId, escalation.notificationId);

						processedEscalations.push(escalation);
					} else {
						this.logger.warn({
							message: `Failed to send escalation for monitor ${monitor.id}, will retry on next check`,
							service: SERVICE_NAME,
							method: "processEscalations",
						});
					}
				} catch (error: unknown) {
					this.logger.error({
						message: `Failed to process escalation for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "processEscalations",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		}

		return processedEscalations;
	};

	/**
	 * Reset all escalations for a monitor (set isSent flag to false)
	 * Called when a monitor recovers from an incident
	 * @param monitorId - The monitor ID
	 * @param teamId - The team ID
	 */
	resetEscalations = async (monitorId: string, teamId: string): Promise<void> => {
		await this.monitorsRepository.resetEscalations(monitorId, teamId);
		this.logger.info({
			message: `Reset escalations for monitor ${monitorId}`,
			service: SERVICE_NAME,
			method: "resetEscalations",
		});
	};
}
