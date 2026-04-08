const SERVICE_NAME = "EscalationService";
import type { Monitor } from "@/types/monitor.js";
import type { Incident } from "@/types/index.js";
import { AppError } from "@/utils/AppError.js";
import type { IIncidentsRepository, IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ISettingsService } from "@/service/system/settingsService.js";

export interface IEscalationService {
	readonly serviceName: string;
	processEscalations(): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private notificationsRepository: INotificationsRepository;
	private notificationsService: INotificationsService;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private settingsService: ISettingsService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		notificationsRepository: INotificationsRepository,
		notificationsService: INotificationsService,
		notificationMessageBuilder: INotificationMessageBuilder,
		settingsService: ISettingsService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.notificationsRepository = notificationsRepository;
		this.notificationsService = notificationsService;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.settingsService = settingsService;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	processEscalations = async (): Promise<void> => {
		try {
			this.logger.debug({
				message: "Starting escalation processing",
				service: SERVICE_NAME,
				method: "processEscalations",
			});

			// Get all monitors
			const monitors = await this.monitorsRepository.findAll();
			if (!monitors) {
				this.logger.debug({
					message: "No monitors found for escalation processing",
					service: SERVICE_NAME,
					method: "processEscalations",
				});
				return;
			}

			for (const monitor of monitors) {
				await this.processMonitorEscalations(monitor);
			}

			this.logger.debug({
				message: `Processed escalations for ${monitors.length} monitors`,
				service: SERVICE_NAME,
				method: "processEscalations",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error processing escalations: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "processEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private processMonitorEscalations = async (monitor: Monitor): Promise<void> => {
		try {
			// Check if monitor has escalation rules
			if (!monitor.escalatedRules || monitor.escalatedRules.length === 0) {
				return;
			}

			// Get active incident for this monitor
			const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
			if (!activeIncident) {
				// Monitor is not currently down, no escalation needed
				return;
			}

			// Calculate downtime duration in minutes
			const startTimeMs = new Date(activeIncident.startTime).getTime();
			const downtimeMs = Date.now() - startTimeMs;
			const downtimeMinutes = Math.floor(downtimeMs / (1000 * 60));

			this.logger.debug({
				message: `Monitor ${monitor.name} has been down for ${downtimeMinutes} minutes`,
				service: SERVICE_NAME,
				method: "processMonitorEscalations",
				details: { monitorId: monitor.id, incidentId: activeIncident.id },
			});

			// Check each escalation rule
			for (const rule of monitor.escalatedRules) {
				if (downtimeMinutes >= rule.delayMinutes) {
					await this.triggerEscalation(monitor, activeIncident, rule, downtimeMinutes);
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error processing escalations for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "processMonitorEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private triggerEscalation = async (
		monitor: Monitor,
		incident: Incident,
		rule: { delayMinutes: number },
		downtimeMinutes: number
	): Promise<void> => {
		try {
			// Check if we've already sent an escalation for this rule and incident
			// For now, we'll send escalations every time the condition is met
			// In a production system, you might want to track sent escalations to avoid duplicates

			this.logger.info({
				message: `Triggering escalation for monitor ${monitor.name} after ${downtimeMinutes} minutes (rule: ${rule.delayMinutes} minutes)`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
				details: { monitorId: monitor.id, incidentId: incident.id, ruleDelay: rule.delayMinutes },
			});

			// Get monitor notifications
			const notificationIds = monitor.notifications ?? [];
			if (notificationIds.length === 0) {
				this.logger.debug({
					message: `No notifications configured for monitor ${monitor.name}`,
					service: SERVICE_NAME,
					method: "triggerEscalation",
				});
				return;
			}

			const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

			// Send escalation notifications
			for (const notification of notifications) {
				await this.sendEscalationNotification(notification, monitor, incident, rule, downtimeMinutes);
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error triggering escalation for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationNotification = async (
		notification: any,
		monitor: Monitor,
		incident: Incident,
		rule: { delayMinutes: number },
		downtimeMinutes: number
	): Promise<void> => {
		try {
			// Create mock MonitorStatusResponse for escalation
			const mockMonitorStatusResponse = {
				monitorId: monitor.id,
				teamId: monitor.teamId,
				type: monitor.type,
				status: false, // Monitor is down
				code: 9999, // Special code for escalation
				message: `Monitor has been down for ${downtimeMinutes} minutes (escalation threshold: ${rule.delayMinutes} minutes)`,
				responseTime: 0,
				timings: undefined,
			};

			// Create mock MonitorActionDecision for escalation
			const mockDecision = {
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "status_change" as const,
			};

			// Get client host for notification
			const settings = this.settingsService.getSettings();
			const clientHost = settings.clientHost || "Host not defined";

			// Build notification message
			const notificationMessage = this.notificationMessageBuilder.buildMessage(
				monitor,
				mockMonitorStatusResponse,
				mockDecision,
				clientHost
			);

			// Override the message content for escalation
			notificationMessage.type = "monitor_down";
			notificationMessage.content.title = `ESCALATION: Monitor ${monitor.name} Down for ${downtimeMinutes} Minutes`;
			notificationMessage.content.summary = `Monitor ${monitor.name} has been down for ${downtimeMinutes} minutes, exceeding the escalation threshold of ${rule.delayMinutes} minutes. Incident started at ${new Date(parseInt(incident.startTime)).toISOString()}.`;

			// Send the notification
			const success = await (this.notificationsService as any).send(
				notification,
				monitor,
				mockMonitorStatusResponse,
				mockDecision,
				notificationMessage
			);

			if (success) {
				this.logger.info({
					message: `Escalation notification sent successfully for monitor ${monitor.name}`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
					details: { monitorId: monitor.id, notificationType: notification.type },
				});
			} else {
				this.logger.warn({
					message: `Failed to send escalation notification for monitor ${monitor.name}`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
					details: { monitorId: monitor.id, notificationType: notification.type },
				});
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error sending escalation notification: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};
}