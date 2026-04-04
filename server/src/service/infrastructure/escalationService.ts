import type { Monitor, Incident } from "@/types/index.js";
import type { IIncidentsRepository, INotificationsRepository, IMonitorsRepository } from "@/repositories/index.js";
import type { IEscalationPoliciesRepository } from "@/repositories/escalationPolicies/index.js";
import type { ILogger } from "@/utils/logger.js";
import type { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { AppError } from "@/utils/AppError.js";

const SERVICE_NAME = "EscalationService";

export interface IEscalationService {
	checkAndTriggerEscalations(): Promise<void>;
	applyEscalationToIncident(incident: Incident, monitor: Monitor): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private incidentsRepository: IIncidentsRepository;
	private escalationPoliciesRepository: IEscalationPoliciesRepository;
	private notificationsRepository: INotificationsRepository;
	private monitorsRepository: IMonitorsRepository;
	private emailProvider: INotificationProvider;
	private slackProvider: INotificationProvider;
	private discordProvider: INotificationProvider;
	private webhookProvider: INotificationProvider;
	private pagerDutyProvider: INotificationProvider;
	private matrixProvider: INotificationProvider;
	private teamsProvider: INotificationProvider;
	private logger: ILogger;
	private settingsService: ISettingsService;
	private notificationMessageBuilder: INotificationMessageBuilder;

	constructor(
		incidentsRepository: IIncidentsRepository,
		escalationPoliciesRepository: IEscalationPoliciesRepository,
		notificationsRepository: INotificationsRepository,
		monitorsRepository: IMonitorsRepository,
		emailProvider: INotificationProvider,
		slackProvider: INotificationProvider,
		discordProvider: INotificationProvider,
		webhookProvider: INotificationProvider,
		pagerDutyProvider: INotificationProvider,
		matrixProvider: INotificationProvider,
		teamsProvider: INotificationProvider,
		logger: ILogger,
		settingsService: ISettingsService,
		notificationMessageBuilder: INotificationMessageBuilder
	) {
		this.incidentsRepository = incidentsRepository;
		this.escalationPoliciesRepository = escalationPoliciesRepository;
		this.notificationsRepository = notificationsRepository;
		this.monitorsRepository = monitorsRepository;
		this.emailProvider = emailProvider;
		this.slackProvider = slackProvider;
		this.discordProvider = discordProvider;
		this.webhookProvider = webhookProvider;
		this.pagerDutyProvider = pagerDutyProvider;
		this.matrixProvider = matrixProvider;
		this.teamsProvider = teamsProvider;
		this.logger = logger;
		this.settingsService = settingsService;
		this.notificationMessageBuilder = notificationMessageBuilder;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	/**
	 * Check all active incidents and trigger escalations if conditions are met
	 * This should be called periodically (e.g., every minute)
	 */
	
checkAndTriggerEscalations = async (): Promise<void> => {
    try {
        const monitors = await this.monitorsRepository.findAll();
        if (!monitors) return;

        for (const monitor of monitors) {
            const delay = (monitor as any).escalationDelay;
            const notificationIds = (monitor as any).escalationNotifications;
            if (!delay || !notificationIds || notificationIds.length === 0) continue;

            const activeIncident = await this.incidentsRepository.findActiveByMonitorId(
                monitor.id,
                monitor.teamId
            );
            if (!activeIncident) continue;

            const durationMinutes = Math.floor(
                (Date.now() - new Date(activeIncident.startTime).getTime()) / (1000 * 60)
            );

            if (
                durationMinutes >= delay &&
                !activeIncident.escalationEventsTriggered.includes(delay)
            ) {
                await this.sendEscalationNotifications(monitor, activeIncident, notificationIds);

                activeIncident.escalationEventsTriggered.push(delay);
                await this.incidentsRepository.updateById(
                    activeIncident.id,
                    activeIncident.teamId,
                    { escalationEventsTriggered: activeIncident.escalationEventsTriggered }
                );

                this.logger.info({
                    service: SERVICE_NAME,
                    method: "checkAndTriggerEscalations",
                    message: "Escalation triggered",
                    details: { monitorId: monitor.id, delayMinutes: delay },
                });
            }
        }
    } catch (error) {
        this.logger.error({
            service: SERVICE_NAME,
            method: "checkAndTriggerEscalations",
            message: error instanceof Error ? error.message : "Unknown error",
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
};

	/**
	 * Send escalation notifications for a specific rule
	 */
	private sendEscalationNotifications = async (
		monitor: Monitor,
		incident: Incident,
		notificationIds: string[]
	): Promise<void> => {
		try {
			const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

			const settings = this.settingsService.getSettings();
			const clientHost = settings.clientHost || "Host not defined";

			// Calculate incident duration
			const durationMinutes = Math.floor((Date.now() - new Date(incident.startTime).getTime()) / (1000 * 60));

			// Create a decision object for message building
			const decision = {
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null as any,
				notificationReason: "status_change" as const,
			};

			for (const notification of notifications) {
				try {
					// Build notification message
					const notificationMessage = this.notificationMessageBuilder.buildMessage(
						monitor,
						{ statusCode: incident.statusCode || 0 } as any,
						decision,
						clientHost
					);
                    // Override with escalation-specific messaging
                    if (notificationMessage.content && typeof notificationMessage.content === "object") {
                        (notificationMessage.content as any).escalationDurationMinutes = durationMinutes;
                        (notificationMessage.content as any).isEscalation = true;
                        (notificationMessage.content as any).title = `Escalation: Monitor ${monitor.name} still down`;
                        (notificationMessage.content as any).summary = `Monitor "${monitor.name}" has remained down for at least ${durationMinutes} minute(s).`;
                    }
                    if (notificationMessage.subject !== undefined) {
                        (notificationMessage as any).subject = `Escalation: Monitor ${monitor.name} still down`;
                    }

					// Add escalation context to the message
					if (notificationMessage.content && typeof notificationMessage.content === "object") {
						(notificationMessage.content as any).escalationDurationMinutes = durationMinutes;
						(notificationMessage.content as any).isEscalation = true;
					}

					await this.sendNotification(notification, notificationMessage);
				} catch (error) {
					this.logger.error({
						service: SERVICE_NAME,
						method: "sendEscalationNotifications",
						message: `Failed to send escalation notification: ${error instanceof Error ? error.message : "Unknown error"}`,
						details: { notificationId: notification.id },
					});
				}
			}
		} catch (error) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
				message: error instanceof Error ? error.message : "Unknown error",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Send a single notification
	 */
	private sendNotification = async (notification: any, notificationMessage: any): Promise<boolean> => {
		switch (notification.type) {
			case "email":
				return await this.emailProvider.sendMessage!(notification, notificationMessage);
			case "slack":
				return await this.slackProvider.sendMessage!(notification, notificationMessage);
			case "discord":
				return await this.discordProvider.sendMessage!(notification, notificationMessage);
			case "webhook":
				return await this.webhookProvider.sendMessage!(notification, notificationMessage);
			case "pager_duty":
				return await this.pagerDutyProvider.sendMessage!(notification, notificationMessage);
			case "matrix":
				return await this.matrixProvider.sendMessage!(notification, notificationMessage);
			case "teams":
				return await this.teamsProvider.sendMessage!(notification, notificationMessage);
			default:
				this.logger.warn({
					service: SERVICE_NAME,
					method: "sendNotification",
					message: `Unknown notification type: ${notification.type}`,
				});
				return false;
		}
	};
}
