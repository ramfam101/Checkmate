const SERVICE_NAME = "escalationService";

import type { Monitor } from "@/types/monitor.js";
import type { Incident } from "@/types/incident.js";
import { AppError } from "@/utils/AppError.js";
import type { IIncidentsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";

export interface IEscalationService {
	checkAndTriggerEscalations(incident: Incident, monitor: Monitor): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private notificationsService: INotificationsService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		notificationsService: INotificationsService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.notificationsService = notificationsService;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	checkAndTriggerEscalations = async (incident: Incident, monitor: Monitor): Promise<void> => {
		try {
			// If no escalation rules, nothing to do
			if (!monitor.escalationRules || monitor.escalationRules.length === 0) {
				return;
			}

			// Only process active incidents (not resolved)
			if (!incident.status) {
				return;
			}

			// Calculate incident duration in minutes
			const incidentStartTime = new Date(incident.startTime).getTime();
			const currentTime = Date.now();
			const incidentDurationMinutes = Math.floor((currentTime - incidentStartTime) / (1000 * 60));

			// Track which escalations to send
			const escalationsToSend: Array<{ delayMinutes: number; notificationIds: string[] }> = [];

			// Check each escalation rule
			for (const rule of monitor.escalationRules) {
				// Check if incident duration has reached or exceeded this delay
				if (incidentDurationMinutes >= rule.delayMinutes) {
					// Check if escalation already sent
					const alreadySent = incident.escalationsSent?.some((sent) => sent.delayMinutes === rule.delayMinutes);

					if (!alreadySent) {
						escalationsToSend.push(rule);
					}
				}
			}

			// Send escalations
			for (const escalation of escalationsToSend) {
				await this.sendEscalation(incident, monitor, escalation);
			}
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "checkAndTriggerEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};

	private sendEscalation = async (
		incident: Incident,
		monitor: Monitor,
		escalation: { delayMinutes: number; notificationIds: string[] }
	): Promise<void> => {
		try {
			// Create a temporary monitor object with only escalation notification IDs
			const escalationMonitor = {
				...monitor,
				notifications: escalation.notificationIds,
			};

			// Create a mock notification decision for escalation
			const escalationDecision = {
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null as const,
				notificationReason: "escalation" as const,
			};

			// Create mock status response for escalation
			const escalationStatus = {
				code: incident.statusCode ?? 503,
				message: `Incident escalation: Monitor down for over ${escalation.delayMinutes} minutes`,
				responseTime: 0,
				statusCode: incident.statusCode ?? 503,
			};

			// Send notifications using the notifications service
			await this.notificationsService.handleNotifications(escalationMonitor, escalationStatus, escalationDecision).catch((error: unknown) => {
				this.logger.error({
					message: `Error sending escalation notification for incident ${incident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
					service: SERVICE_NAME,
					method: "sendEscalation",
					stack: error instanceof Error ? error.stack : undefined,
				});
				// Continue on error, don't block
			});

			// Record escalation as sent in incident
			const updatedEscalationsSent = [
				...(incident.escalationsSent || []),
				{ delayMinutes: escalation.delayMinutes, sentAt: new Date().toISOString() },
			];

			await this.incidentsRepository.updateById(incident.id, incident.teamId, {
				escalationsSent: updatedEscalationsSent as any,
			});

			this.logger.info({
				message: `Escalation sent for incident ${incident.id} after ${escalation.delayMinutes} minutes`,
				service: SERVICE_NAME,
				method: "sendEscalation",
				details: { notificationCount: escalation.notificationIds.length },
			});
		} catch (error: unknown) {
			this.logger.warn({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "sendEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};
}
