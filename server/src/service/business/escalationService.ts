const SERVICE_NAME = "EscalationService";

import { IIncidentsRepository, IMonitorsRepository } from "@/repositories/index.js";
import { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import { ILogger } from "@/utils/logger.js";
import { Monitor, MonitorStatusResponse } from "@/types/index.js";
import { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";

export interface IEscalationService {
	readonly serviceName: string;
	checkAndSendEscalations(): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private notificationsService: INotificationsService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		notificationsService: INotificationsService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.notificationsService = notificationsService;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	checkAndSendEscalations = async (): Promise<void> => {
		try {
			this.logger.info({
				message: "Checking for incidents that need escalation notifications",
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
			});

			// Find all active incidents
			const activeIncidents = await this.incidentsRepository.findAllActive();

			if (!activeIncidents || activeIncidents.length === 0) {
				this.logger.debug({
					message: "No active incidents to check for escalation",
					service: SERVICE_NAME,
					method: "checkAndSendEscalations",
				});
				return;
			}

			const now = Date.now();

			for (const incident of activeIncidents) {
				try {
					// Get the monitor
					const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);

					if (!monitor) {
						this.logger.warn({
							message: `Monitor ${incident.monitorId} not found`,
							service: SERVICE_NAME,
							method: "checkAndSendEscalations",
						});
						continue;
					}

					// Check if escalation is enabled for this monitor
					// Escalation is enabled if escalationAfterMinutes is set to > 0
					if (!monitor.escalationAfterMinutes || monitor.escalationAfterMinutes <= 0) {
						this.logger.debug({
							message: `Escalation disabled for monitor ${monitor.id}: escalationAfterMinutes=${monitor.escalationAfterMinutes}`,
							service: SERVICE_NAME,
							method: "checkAndSendEscalations",
						});
						continue;
					}

					// Calculate how long the incident has been active
					const incidentStartTime = new Date(incident.startTime).getTime();
					const incidentDurationMs = now - incidentStartTime;
					const incidentDurationMinutes = incidentDurationMs / (1000 * 60);

					// Get last escalation time for THIS incident
					// Only use monitor.lastEscalationSentAt if it was sent after this incident started
					// Otherwise, treat this as the first escalation for this incident
					let lastEscalationTime = incidentStartTime;
					if (monitor.lastEscalationSentAt) {
						const lastEscalationMs = new Date(monitor.lastEscalationSentAt).getTime();
						// Only use lastEscalationSentAt if it's after the incident started (same incident)
						if (lastEscalationMs >= incidentStartTime) {
							lastEscalationTime = lastEscalationMs;
						}
					}

					// Calculate time since last escalation (or incident start for first escalation)
					const timeSinceLastEscalationMs = now - lastEscalationTime;
					const timeSinceLastEscalationMinutes = timeSinceLastEscalationMs / (1000 * 60);

					// Check if we should send an escalation
					// Only send if:
					// 1. Enough time has passed since the incident started
					// 2. We haven't already sent an escalation for this incident
					const hasTimePassed = timeSinceLastEscalationMinutes >= monitor.escalationAfterMinutes;
					const hasNotBeenSent = lastEscalationTime === incidentStartTime;
					
					this.logger.debug({
						message: `Escalation check for monitor ${monitor.id}`,
						service: SERVICE_NAME,
						method: "checkAndSendEscalations",
						details: {
							timeSinceLastEscalation: `${timeSinceLastEscalationMinutes.toFixed(2)} minutes`,
							escalationThreshold: `${monitor.escalationAfterMinutes} minutes`,
							hasTimePassed,
							hasNotBeenSent,
							willSend: hasTimePassed && hasNotBeenSent,
						},
					});

					if (hasTimePassed && hasNotBeenSent) {
						await this.sendEscalationNotification(monitor, incident);

						// Update the monitor's lastEscalationSentAt
						await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
							lastEscalationSentAt: new Date().toISOString(),
						});

						this.logger.info({
							message: `Escalation notification sent for monitor ${monitor.id}`,
							service: SERVICE_NAME,
							method: "checkAndSendEscalations",
							details: {
								monitorId: monitor.id,
								incidentDuration: `${incidentDurationMinutes.toFixed(2)} minutes`,
								escalationThreshold: `${monitor.escalationAfterMinutes} minutes`,
							},
						});
					}
				} catch (error: unknown) {
					this.logger.error({
						message: `Error processing incident ${incident.id}: ${error instanceof Error ? error.message : String(error)}`,
						service: SERVICE_NAME,
						method: "checkAndSendEscalations",
						stack: error instanceof Error ? error.stack : undefined,
					});
					continue;
				}
			}

			this.logger.info({
				message: "Escalation check completed",
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error during escalation check: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationNotification = async (monitor: Monitor, incident: any): Promise<void> => {
		// Check if monitor has escalation notifications configured
		if (!monitor.escalationNotifications || monitor.escalationNotifications.length === 0) {
			this.logger.warn({
				message: `Monitor ${monitor.id} has escalation enabled but no notification channels configured`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
			});
			return;
		}

		// Create a mock status response for the notification
		const escalationResponse: MonitorStatusResponse = {
			monitorId: monitor.id,
			teamId: monitor.teamId,
			type: monitor.type as any,
			status: monitor.status === "down",
			code: incident.statusCode || 0,
			message: `ESCALATION: ${incident.message || `Monitor has been down for more than ${monitor.escalationAfterMinutes} minutes`}`,
			responseTime: 0,
		};

		// Build decision for escalation notification
		const decision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: null,
			notificationReason: "escalation",
		};

		// Temporarily set the monitor's notifications to escalation notifications
		const originalNotifications = monitor.notifications;
		monitor.notifications = monitor.escalationNotifications;

		try {
			await this.notificationsService.handleNotifications(monitor, escalationResponse, decision);
		} finally {
			// Restore original notifications
			monitor.notifications = originalNotifications;
		}
	};
}
