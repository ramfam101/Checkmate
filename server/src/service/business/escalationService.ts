import type { Monitor, MonitorEscalationRule } from "@/types/monitor.js";
import type { Incident } from "@/types/incident.js";
import { IMonitorsRepository, IIncidentsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";

export interface IEscalationService {
	checkAndSendEscalations(): Promise<void>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private monitorsRepository: IMonitorsRepository;
	private incidentsRepository: IIncidentsRepository;
	private notificationsRepository: INotificationsRepository;
	private notificationsService: INotificationsService;
	private logger: ILogger;
	private sentEscalations: Set<string>; // Track sent escalations as "incidentId-ruleId"

	constructor(
		monitorsRepository: IMonitorsRepository,
		incidentsRepository: IIncidentsRepository,
		notificationsRepository: INotificationsRepository,
		notificationsService: INotificationsService,
		logger: ILogger
	) {
		this.monitorsRepository = monitorsRepository;
		this.incidentsRepository = incidentsRepository;
		this.notificationsRepository = notificationsRepository;
		this.notificationsService = notificationsService;
		this.logger = logger;
		this.sentEscalations = new Set();
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	checkAndSendEscalations = async (): Promise<void> => {
		try {
			this.logger.debug({
				message: "Starting escalation check",
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
			});

			// Find all active incidents
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();
			const activeIncidentIds = new Set(activeIncidents.map((incident) => incident.id));

			// Clean up sent escalations for resolved incidents
			for (const key of this.sentEscalations) {
				const incidentId = key.split("-")[0];
				if (incidentId && !activeIncidentIds.has(incidentId)) {
					this.sentEscalations.delete(key);
				}
			}

			for (const incident of activeIncidents) {
				await this.checkEscalationForIncident(incident);
			}

			this.logger.debug({
				message: `Escalation check completed for ${activeIncidents.length} active incidents`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error during escalation check: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private checkEscalationForIncident = async (incident: Incident): Promise<void> => {
		try {
			// Get the monitor with escalation rules
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);

			if (!monitor || !monitor.escalationRules || monitor.escalationRules.length === 0) {
				return; // No escalation rules configured
			}

			const incidentStartTime = new Date(incident.startTime).getTime();
			const now = Date.now();
			const incidentDurationMinutes = (now - incidentStartTime) / (1000 * 60);

			// Check each escalation rule
			for (const rule of monitor.escalationRules) {
				if (!rule.isEnabled || rule.notificationIds.length === 0) {
					continue;
				}

				// Determine elapsed escalation windows
				const elapsedSteps = Math.floor(incidentDurationMinutes / rule.escalateAfterMinutes);
				if (elapsedSteps < 1) {
					continue;
				}

				for (let step = 1; step <= elapsedSteps; step += 1) {
					const alreadySent = await this.hasEscalationBeenSent(incident.id, rule.id, step);
					if (!alreadySent) {
						// Send escalation notifications for the next pending interval
						await this.sendEscalationNotifications(monitor, incident, rule);
						await this.markEscalationAsSent(incident.id, rule.id, step);
						break;
					}
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error checking escalation for incident ${incident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "checkEscalationForIncident",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationNotifications = async (monitor: Monitor, incident: Incident, rule: MonitorEscalationRule): Promise<void> => {
		try {
			// Get the notifications for this escalation rule
			const notifications = await this.notificationsRepository.findNotificationsByIds(rule.notificationIds);

			// For now, only handle email notifications
			const emailNotifications = notifications.filter((n) => n.type === "email");

			if (emailNotifications.length === 0) {
				return;
			}

			// Create a mock monitor status response for escalation
			const mockMonitorStatusResponse = {
				monitorId: monitor.id,
				teamId: monitor.teamId,
				type: monitor.type,
				status: false, // Monitor is down
				code: incident.statusCode || 0,
				message: incident.message || "Monitor is down",
				responseTime: 0,
				timings: undefined,
				statusCode: incident.statusCode || 0,
				headers: {},
				cookies: [],
				body: "",
				isResponseTimeAlert: false,
				isStatusCodeAlert: false,
				hardwareData: null,
			};

			// Create escalation decision
			const escalationDecision = {
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "status_change" as const,
			};

			const incidentStartTime = new Date(incident.startTime).getTime();
			const incidentAgeMinutes = Math.max(1, Math.floor((Date.now() - incidentStartTime) / (1000 * 60)));
			const incidentDurationLabel = incidentAgeMinutes === 1 ? "about a minute" : `${incidentAgeMinutes} minutes`;

			// Build escalation-specific message
			const escalationMessage = {
				type: "monitor_down" as const,
				severity: "critical" as const,
				monitor: {
					id: monitor.id,
					name: monitor.name,
					url: monitor.url,
					type: monitor.type,
					status: monitor.status,
				},
				content: {
					title: `ESCALATION: ${monitor.name} is still down`,
					summary: `Monitor "${monitor.name}" has been down for ${incidentDurationLabel}`,
					details: [
						`Original incident started at: ${new Date(incident.startTime).toISOString()}`,
						`Status Code: ${incident.statusCode || "N/A"}`,
						`Message: ${incident.message || "N/A"}`,
						"Please take immediate action.",
					],
					timestamp: new Date(),
				},
				clientHost: "", // Will be set by notification service
				metadata: {
					teamId: monitor.teamId,
					notificationReason: "escalation" as const,
					escalationRuleId: rule.id,
					incidentId: incident.id,
				},
			};

			// Send escalation notifications once per rule
			const success = await this.notificationsService.sendNotificationsByIds(
				rule.notificationIds,
				monitor,
				mockMonitorStatusResponse,
				escalationDecision,
				escalationMessage
			);

			if (success) {
				this.logger.info({
					message: `Escalation notification sent for monitor ${monitor.id}, rule ${rule.id}`,
					service: SERVICE_NAME,
					method: "sendEscalationNotifications",
					details: { monitorId: monitor.id, incidentId: incident.id, ruleId: rule.id },
				});
			} else {
				this.logger.warn({
					message: `Failed to send escalation notification for monitor ${monitor.id}, rule ${rule.id}`,
					service: SERVICE_NAME,
					method: "sendEscalationNotifications",
					details: { monitorId: monitor.id, incidentId: incident.id, ruleId: rule.id },
				});
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error sending escalation notifications: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private hasEscalationBeenSent = async (incidentId: string, ruleId: string, step: number): Promise<boolean> => {
		const key = `${incidentId}-${ruleId}-${step}`;
		return this.sentEscalations.has(key);
	};

	private markEscalationAsSent = async (incidentId: string, ruleId: string, step: number): Promise<void> => {
		const key = `${incidentId}-${ruleId}-${step}`;
		this.sentEscalations.add(key);
		this.logger.debug({
			message: `Marked escalation as sent for incident ${incidentId}, rule ${ruleId}, step ${step}`,
			service: SERVICE_NAME,
			method: "markEscalationAsSent",
		});
	};
}
