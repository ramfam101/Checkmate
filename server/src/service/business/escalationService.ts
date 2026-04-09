const SERVICE_NAME = "escalationService";
import type { Monitor } from "@/types/monitor.js";
import type { Incident } from "@/types/incident.js";
import { AppError } from "@/utils/AppError.js";
import type { IIncidentsRepository, IMonitorsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";

export interface IEscalationService {
	readonly serviceName: string;
	checkAndTriggerEscalations(): Promise<void>;
	triggerEscalation(incidentId: string): Promise<boolean>;
	markIncidentEscalated(incidentId: string): Promise<void>;
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

	checkAndTriggerEscalations = async (): Promise<void> => {
		try {
			this.logger.debug({
				message: "Starting escalation check",
				service: SERVICE_NAME,
				method: "checkAndTriggerEscalations",
			});

			// Find all active incidents that haven't been escalated yet
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();

			if (!activeIncidents || activeIncidents.length === 0) {
				this.logger.debug({
					message: "No active incidents found",
					service: SERVICE_NAME,
					method: "checkAndTriggerEscalations",
				});
				return;
			}

			const now = new Date();
			let escalationTriggered = 0;

			for (const incident of activeIncidents) {
				try {
					// Skip if already escalated
					if (incident.escalated) {
						continue;
					}

					// Get the monitor to check escalation settings
					const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);

					if (!monitor) {
						this.logger.warn({
							message: `Monitor not found for incident ${incident.id}`,
							service: SERVICE_NAME,
							method: "checkAndTriggerEscalations",
							details: { incidentId: incident.id, monitorId: incident.monitorId },
						});
						continue;
					}

					// Skip if escalation is not enabled for this monitor
					if (!monitor.escalationEnabled) {
						continue;
					}

					// Check if incident has exceeded the escalation delay
					const incidentStartTime = new Date(incident.startTime);
					const escalationThreshold = new Date(incidentStartTime.getTime() + (monitor.escalationDelayMinutes * 60 * 1000));

					if (now >= escalationThreshold) {
						this.logger.info({
							message: `Triggering escalation for incident ${incident.id}`,
							service: SERVICE_NAME,
							method: "checkAndTriggerEscalations",
							details: {
								incidentId: incident.id,
								monitorId: monitor.id,
								delayMinutes: monitor.escalationDelayMinutes,
								startTime: incident.startTime,
							},
						});

						const success = await this.triggerEscalation(incident.id);
						if (success) {
							escalationTriggered++;
						}
					}
				} catch (error: unknown) {
					this.logger.error({
						message: `Error processing incident ${incident.id} for escalation`,
						service: SERVICE_NAME,
						method: "checkAndTriggerEscalations",
						details: { incidentId: incident.id },
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}

			if (escalationTriggered > 0) {
				this.logger.info({
					message: `Escalation check completed: ${escalationTriggered} escalations triggered`,
					service: SERVICE_NAME,
					method: "checkAndTriggerEscalations",
				});
			}
		} catch (error: unknown) {
			this.logger.error({
				message: "Error in escalation check",
				service: SERVICE_NAME,
				method: "checkAndTriggerEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};

	triggerEscalation = async (incidentId: string): Promise<boolean> => {
		try {
			// Get the incident - we need to find it first to get the teamId
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();
			const incident = activeIncidents.find(inc => inc.id === incidentId);
			
			if (!incident) {
				this.logger.error({
					message: "Incident not found in active incidents",
					service: SERVICE_NAME,
					method: "triggerEscalation",
					details: { incidentId },
				});
				return false;
			}

			// Get the monitor
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor) {
				throw new AppError({
					message: "Monitor not found",
					service: SERVICE_NAME,
					method: "triggerEscalation",
				});
			}

			// Check if escalation notifications are configured
			if (!monitor.escalationNotifications || monitor.escalationNotifications.length === 0) {
				this.logger.warn({
					message: "No escalation notifications configured for monitor",
					service: SERVICE_NAME,
					method: "triggerEscalation",
					details: { monitorId: monitor.id, incidentId },
				});
				return false;
			}

			// Calculate how long the incident has been active
			const incidentStartTime = new Date(incident.startTime);
			const now = new Date();
			const minutesActive = Math.floor((now.getTime() - incidentStartTime.getTime()) / (1000 * 60));

			// Build escalation message
			const escalationMessage = monitor.escalationMessage?.replace("{{minutes}}", minutesActive.toString()) ||
				`ESCALATION: Issue has persisted for ${minutesActive} minutes without resolution.`;

			// Send escalation notifications
			// Note: We'll need to implement this in the notifications service
			// For now, we'll mark the incident as escalated
			await this.markIncidentEscalated(incidentId);

			this.logger.info({
				message: `Escalation triggered for incident ${incidentId}`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
				details: {
					incidentId,
					monitorId: monitor.id,
					minutesActive,
					escalationMessage,
				},
			});

			return true;
		} catch (error: unknown) {
			this.logger.error({
				message: `Error triggering escalation for incident ${incidentId}`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
				details: { incidentId },
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
	};

	markIncidentEscalated = async (incidentId: string): Promise<void> => {
		try {
			const updateData = {
				escalated: true,
				escalatedAt: new Date().toISOString(),
				escalationLevel: 1, // For future multi-level escalation
			};

			await this.incidentsRepository.updateById(incidentId, "", updateData);

			this.logger.debug({
				message: `Marked incident ${incidentId} as escalated`,
				service: SERVICE_NAME,
				method: "markIncidentEscalated",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error marking incident ${incidentId} as escalated`,
				service: SERVICE_NAME,
				method: "markIncidentEscalated",
				details: { incidentId },
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};
}