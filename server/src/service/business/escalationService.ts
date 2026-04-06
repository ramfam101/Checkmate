const SERVICE_NAME = "EscalationService";

import type { Monitor, Incident, Notification } from "@/types/index.js";
import type { NotificationMessage, NotificationType, NotificationSeverity } from "@/types/notificationMessage.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import { AppError } from "@/utils/AppError.js";
import type { IIncidentsRepository, IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ILogger } from "@/utils/logger.js";
import type { ISettingsService } from "@/service/system/settingsService.js";

export interface IEscalationService {
	checkAndSendEscalations: () => Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private monitorsRepository: IMonitorsRepository;
	private incidentsRepository: IIncidentsRepository;
	private notificationsRepository: INotificationsRepository;
	private notificationsService: INotificationsService;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private settingsService: ISettingsService;

	constructor(
		logger: ILogger,
		monitorsRepository: IMonitorsRepository,
		incidentsRepository: IIncidentsRepository,
		notificationsRepository: INotificationsRepository,
		notificationsService: INotificationsService,
		notificationMessageBuilder: INotificationMessageBuilder,
		settingsService: ISettingsService
	) {
		this.logger = logger;
		this.monitorsRepository = monitorsRepository;
		this.incidentsRepository = incidentsRepository;
		this.notificationsRepository = notificationsRepository;
		this.notificationsService = notificationsService;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.settingsService = settingsService;
	}

	checkAndSendEscalations = async (): Promise<void> => {
		try {
			this.logger.info({
				message: "Starting escalation check",
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
			});

			const monitors = await this.monitorsRepository.findMonitorsWithEscalation();

			this.logger.info({
				message: `Found ${monitors?.length || 0} monitors with escalation configured`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
			});

			for (const monitor of monitors ?? []) {
				this.logger.debug({
					message: `Checking escalation for monitor ${monitor.id} (${monitor.name})`,
					service: SERVICE_NAME,
					method: "checkAndSendEscalations",
				});

				const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);

				if (!activeIncident) {
					this.logger.debug({
						message: `No active incident found for monitor ${monitor.id}`,
						service: SERVICE_NAME,
						method: "checkAndSendEscalations",
					});
					continue;
				}

				if (!monitor.escalationDelayMinutes) {
					this.logger.debug({
						message: `Monitor ${monitor.id} has no escalation delay configured`,
						service: SERVICE_NAME,
						method: "checkAndSendEscalations",
					});
					continue;
				}

				const downtimeMinutes =
					(Date.now() - new Date(activeIncident.startTime).getTime()) / (1000 * 60);

				this.logger.debug({
					message: `Monitor ${monitor.id}: downtime=${downtimeMinutes.toFixed(2)}min, threshold=${monitor.escalationDelayMinutes}min, lastEscalation=${monitor.lastEscalationSent}`,
					service: SERVICE_NAME,
					method: "checkAndSendEscalations",
				});

				const timeSinceLastEscalation = monitor.lastEscalationSent
					? Date.now() - new Date(monitor.lastEscalationSent).getTime()
					: null;

				const shouldSendEscalation =
					downtimeMinutes >= monitor.escalationDelayMinutes &&
					(!monitor.lastEscalationSent ||
						(timeSinceLastEscalation !== null && timeSinceLastEscalation > 24 * 60 * 60 * 1000)); // 24 hour cooldown

				if (shouldSendEscalation) {
					this.logger.info({
						message: `Sending escalation for monitor ${monitor.id} after ${downtimeMinutes.toFixed(2)} minutes of downtime`,
						service: SERVICE_NAME,
						method: "checkAndSendEscalations",
					});

					await this.sendEscalationNotifications(monitor, activeIncident, downtimeMinutes);
					await this.monitorsRepository.updateLastEscalationSent(monitor.id, new Date());
				} else {
					this.logger.debug({
						message: `Escalation conditions not met for monitor ${monitor.id}: downtime=${downtimeMinutes.toFixed(2)} >= ${monitor.escalationDelayMinutes}? ${downtimeMinutes >= monitor.escalationDelayMinutes}, timeSinceLast=${timeSinceLastEscalation ? (timeSinceLastEscalation / (1000 * 60 * 60)).toFixed(2) + 'hrs' : 'never'} (needs >24hrs)`,
						service: SERVICE_NAME,
						method: "checkAndSendEscalations",
					});
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error in escalation check",
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationNotifications = async (
		monitor: Monitor,
		incident: Incident,
		downtimeMinutes: number
	): Promise<void> => {
		if (!monitor.escalationNotifications || monitor.escalationNotifications.length === 0) {
			this.logger.warn({
				message: `No escalation notifications configured for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
			});
			return;
		}

		try {
			const notifications = await this.notificationsRepository.findNotificationsByIds(
				monitor.escalationNotifications
			);

			if (!notifications || notifications.length === 0) {
				this.logger.warn({
					message: `No notification configurations found for escalation on monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "sendEscalationNotifications",
				});
				return;
			}

			// Build escalation notification message
			const escalationMessage: NotificationMessage = {
				type: "escalation" as NotificationType,
				severity: "error" as NotificationSeverity,
				monitor: {
					id: monitor.id,
					name: monitor.name,
					url: monitor.url,
					type: monitor.type,
					status: monitor.status,
				},
				content: {
					title: `🚨 Escalation Alert: ${monitor.name}`,
					summary: `${monitor.name} has been down for ${downtimeMinutes.toFixed(0)} minutes`,
					details: [
						`URL: ${monitor.url || "N/A"}`,
						`Status: Down`,
						`Downtime: ${downtimeMinutes.toFixed(2)} minutes`,
						`Incident Started: ${new Date(incident.startTime).toLocaleString()}`,
						`This monitor has exceeded the escalation threshold and requires immediate attention.`,
					],
					timestamp: new Date(),
				},
				clientHost: this.settingsService.getSettings().clientHost || "Checkmate",
				metadata: {
					teamId: monitor.teamId,
					notificationReason: "escalation",
				},
			};

			for (const notification of notifications) {
				try {
					const success = await this.notificationsService.sendEscalationNotification(notification, escalationMessage);

					if (success) {
						this.logger.info({
							message: `Escalation notification sent via ${notification.type} for monitor ${monitor.id}`,
							service: SERVICE_NAME,
							method: "sendEscalationNotifications",
						});
					} else {
						this.logger.error({
							message: `Failed to send escalation notification via ${notification.type} for monitor ${monitor.id}`,
							service: SERVICE_NAME,
							method: "sendEscalationNotifications",
						});
					}
				} catch (notificationError: unknown) {
					this.logger.error({
						message: `Failed to send escalation notification via ${notification.type}: ${
							notificationError instanceof Error ? notificationError.message : "Unknown error"
						}`,
						service: SERVICE_NAME,
						method: "sendEscalationNotifications",
						stack: notificationError instanceof Error ? notificationError.stack : undefined,
					});
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Failed to send escalation notifications: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw new AppError({
				message: "Failed to send escalation notifications",
				status: 500,
			});
		}
	};
}