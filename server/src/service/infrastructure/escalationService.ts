import type { Monitor } from "@/types/index.js";
import type { Incident } from "@/types/incident.js";
import type { IIncidentsRepository, IMonitorsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "./notificationsService.js";
import type { ILogger } from "@/utils/logger.js";
import type { EscalationRule } from "@/types/escalation.js";

export interface IEscalationService {
	checkAndTriggerEscalations(monitor: Monitor, incident: Incident): Promise<void>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	private monitorsRepository: IMonitorsRepository;
	private incidentsRepository: IIncidentsRepository;
	private notificationsService: INotificationsService;
	private logger: ILogger;

	constructor(
		monitorsRepository: IMonitorsRepository,
		incidentsRepository: IIncidentsRepository,
		notificationsService: INotificationsService,
		logger: ILogger
	) {
		this.monitorsRepository = monitorsRepository;
		this.incidentsRepository = incidentsRepository;
		this.notificationsService = notificationsService;
		this.logger = logger;
	}

	/**
	 * Check if any escalation rules should be triggered for an active incident
	 */
	checkAndTriggerEscalations = async (monitor: Monitor, incident: Incident): Promise<void> => {
		// Early exit if no escalation rules
		if (!monitor.escalationRules || monitor.escalationRules.length === 0) {
			this.logger.debug({
				message: `No escalation rules configured for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "checkAndTriggerEscalations",
			});
			return;
		}

		// Can't escalate without incident start time
		if (!incident.startTime) {
			this.logger.warn({
				message: `Incident ${incident.id} for monitor ${monitor.id} has no start time`,
				service: SERVICE_NAME,
				method: "checkAndTriggerEscalations",
			});
			return;
		}

		// Don't escalate if incident is already resolved
		if (incident.endTime) {
			this.logger.debug({
				message: `Incident ${incident.id} for monitor ${monitor.id} is already resolved, skipping escalation check`,
				service: SERVICE_NAME,
				method: "checkAndTriggerEscalations",
			});
			return;
		}

		// Calculate incident duration in minutes
		const incidentDurationMs = Date.now() - new Date(incident.startTime).getTime();
		const incidentDurationMinutes = incidentDurationMs / 1000 / 60;

		this.logger.info({
			message: `Checking ${monitor.escalationRules.length} escalation rules for monitor ${monitor.id}. Incident duration: ${incidentDurationMinutes.toFixed(2)} minutes`,
			service: SERVICE_NAME,
			method: "checkAndTriggerEscalations",
		});

		const escalationHistory = monitor.escalationHistory || [];

		// Check each escalation rule
		for (let i = 0; i < monitor.escalationRules.length; i++) {
			const rule = monitor.escalationRules[i];

			// Skip if rule is undefined (shouldn't happen but type-safe)
			if (!rule) {
				continue;
			}

			// Check if this escalation was already triggered for this incident
			const alreadyTriggered = escalationHistory.some(
				(history) => history.escalationIndex === i && history.incidentId === incident.id
			);

			if (alreadyTriggered) {
				this.logger.debug({
					message: `Escalation rule ${i} already triggered for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "checkAndTriggerEscalations",
				});
				continue;
			}

			// Check if enough time has passed
			if (incidentDurationMinutes >= rule.delayMinutes) {
				this.logger.info({
					message: `Triggering escalation rule ${i} for monitor ${monitor.id} (duration ${incidentDurationMinutes.toFixed(2)}m >= delay ${rule.delayMinutes}m)`,
					service: SERVICE_NAME,
					method: "checkAndTriggerEscalations",
				});
				await this.triggerEscalation(monitor, incident, rule, i);
			} else {
				this.logger.debug({
					message: `Escalation rule ${i} not ready yet for monitor ${monitor.id} (duration ${incidentDurationMinutes.toFixed(2)}m < delay ${rule.delayMinutes}m)`,
					service: SERVICE_NAME,
					method: "checkAndTriggerEscalations",
				});
			}
		}
	};

	/**
	 * Send escalation notifications and record in history
	 */
	private triggerEscalation = async (
		monitor: Monitor,
		incident: Incident,
		rule: EscalationRule,
		escalationIndex: number
	): Promise<void> => {
		try {
			const notificationCount = rule.notificationIds.length;
			this.logger.info({
				message: `Starting escalation trigger for monitor ${monitor.id} rule index ${escalationIndex}, sending to ${notificationCount} notifications`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
			});

			// Send notifications through all channels in this rule
			for (let i = 0; i < rule.notificationIds.length; i++) {
				const notificationId = rule.notificationIds[i];
				if (!notificationId) {
					this.logger.warn({
						message: `Skipping undefined notification ID at index ${i} for monitor ${monitor.id}`,
						service: SERVICE_NAME,
						method: "triggerEscalation",
					});
					continue;
				}
				this.logger.debug({
					message: `Sending escalation notification ${i + 1}/${notificationCount} (ID: ${notificationId})`,
					service: SERVICE_NAME,
					method: "triggerEscalation",
				});
				await this.notificationsService.sendEscalationNotification(
					notificationId,
					monitor,
					incident
				);
			}

			// Record this escalation in history to prevent duplicates
			const escalationHistory = monitor.escalationHistory || [];
			escalationHistory.push({
				escalationIndex,
				triggeredAt: new Date(),
				incidentId: incident.id,
			});

			// Update monitor with new escalation history
			await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
				escalationHistory,
			} as any);

			// Log successful escalation
			this.logger.info({
				message: `Escalation successfully triggered for monitor ${monitor.id} at index ${escalationIndex} (${notificationCount} notifications sent)`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
				details: {
					incidentDurationMinutes: Math.round(
						(Date.now() - new Date(incident.startTime).getTime()) / 1000 / 60
					),
					notificationIds: rule.notificationIds,
				},
			});
		} catch (error) {
			this.logger.error({
				message: `Failed to trigger escalation for monitor ${monitor.id} at index ${escalationIndex}: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
			});
		}
	};
}
