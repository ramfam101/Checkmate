import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository, IIncidentsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;
	handleEscalations: (monitor: Monitor, incidentStartTime: string) => Promise<void>;

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}

const SERVICE_NAME = "NotificationsService";

export class NotificationsService implements INotificationsService {
	static SERVICE_NAME = SERVICE_NAME;

	private notificationsRepository: INotificationsRepository;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private webhookProvider: INotificationProvider;
	private emailProvider: INotificationProvider;
	private slackProvider: INotificationProvider;
	private discordProvider: INotificationProvider;
	private pagerDutyProvider: INotificationProvider;
	private matrixProvider: INotificationProvider;
	private teamsProvider: INotificationProvider;
	private logger: ILogger;
	private settingsService: ISettingsService;
	private notificationMessageBuilder: INotificationMessageBuilder;

	constructor(
		notificationsRepository: INotificationsRepository,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		webhookProvider: INotificationProvider,
		emailProvider: INotificationProvider,
		slackProvider: INotificationProvider,
		discordProvider: INotificationProvider,
		pagerDutyProvider: INotificationProvider,
		matrixProvider: INotificationProvider,
		teamsProvider: INotificationProvider,
		settingsService: ISettingsService,
		logger: ILogger,
		notificationMessageBuilder: INotificationMessageBuilder
	) {
		this.notificationsRepository = notificationsRepository;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.webhookProvider = webhookProvider;
		this.emailProvider = emailProvider;
		this.slackProvider = slackProvider;
		this.discordProvider = discordProvider;
		this.pagerDutyProvider = pagerDutyProvider;
		this.matrixProvider = matrixProvider;
		this.teamsProvider = teamsProvider;
		this.settingsService = settingsService;
		this.logger = logger;
		this.notificationMessageBuilder = notificationMessageBuilder;
	}

	private resolveNotificationsByIds = async (notificationIds: string[], method: string): Promise<Notification[]> => {
		if (notificationIds.length === 0) {
			this.logger.warn({
				message: "No notification IDs were provided",
				service: SERVICE_NAME,
				method,
			});
			return [];
		}

		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);
		if (notifications.length === 0) {
			this.logger.warn({
				message: "Notification lookup returned no channels",
				service: SERVICE_NAME,
				method,
				details: { notificationIds },
			});
			return [];
		}

		const resolvedIds = new Set(notifications.map((notification) => notification.id));
		const missingNotificationIds = notificationIds.filter((id) => !resolvedIds.has(id));

		if (missingNotificationIds.length > 0) {
			this.logger.warn({
				message: "Some notification IDs could not be resolved",
				service: SERVICE_NAME,
				method,
				details: {
					requestedCount: notificationIds.length,
					resolvedCount: notifications.length,
					missingNotificationIds,
				},
			});
		}

		return notifications;
	};

	private send = async (
		notification: Notification,
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		notificationMessage: NotificationMessage | undefined
	): Promise<boolean> => {
		if (!notificationMessage) {
			this.logger.warn({
				message: "Notification message not provided",
				service: SERVICE_NAME,
				method: "send",
			});
			return false;
		}

		// Route to provider based on notification type
		switch (notification.type) {
			case "webhook":
				return await this.webhookProvider.sendMessage!(notification, notificationMessage);
			case "slack":
				return await this.slackProvider.sendMessage!(notification, notificationMessage);
			case "matrix":
				return await this.matrixProvider.sendMessage!(notification, notificationMessage);
			case "pager_duty":
				return await this.pagerDutyProvider.sendMessage!(notification, notificationMessage);
			case "discord":
				return await this.discordProvider.sendMessage!(notification, notificationMessage);
			case "email":
				return await this.emailProvider.sendMessage!(notification, notificationMessage);
			case "teams":
				return await this.teamsProvider.sendMessage!(notification, notificationMessage);
			default:
				this.logger.warn({
					message: `Unknown notification type: ${notification.type}`,
					service: SERVICE_NAME,
					method: "send",
				});
				return false;
		}
	};

	private sendNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const notificationIds = monitor.notifications ?? [];
		const notifications = await this.resolveNotificationsByIds(notificationIds, "sendNotifications");
		if (notifications.length === 0) {
			return false;
		}

		// Build notification message once for all notifications
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		const tasks = notifications.map((notification) => this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage));

		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter(Boolean).length;
		const failed = outcomes.length - succeeded;
		if (failed > 0) {
			this.logger.warn({
				message: `Notification send completed with ${succeeded} success, ${failed} failure(s)`,
				service: SERVICE_NAME,
				method: "sendNotifications",
				details: {
					monitorId: monitor.id,
					notificationIds,
				},
			});
		}
		// Return true if all notifications succeeded
		return succeeded === notifications.length;
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		// Send notifications based on decision
		return await this.sendNotifications(monitor, monitorStatusResponse, decision);
	};

	handleEscalations = async (monitor: Monitor, incidentStartTime: string) => {
		try {
			// Only send escalations if rules exist
			if (!monitor.escalationRules || monitor.escalationRules.length === 0) {
				return;
			}

			// Get the active incident
			const incident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
			if (!incident) {
				return;
			}

			// Calculate downtime in minutes
			const startTime = new Date(incidentStartTime).getTime();
			const now = Date.now();
			const downtimeMinutes = Math.floor((now - startTime) / (1000 * 60));

			// Check which escalation thresholds should trigger
			const escalationsSent = [...(incident.escalationsSent ?? [])];
			const escalationsToSend = monitor.escalationRules.filter(
				(rule) => rule.delayMinutes <= downtimeMinutes && !escalationsSent.includes(rule.delayMinutes)
			);

			if (escalationsToSend.length === 0) {
				return;
			}

			// Get email notifications for this monitor
			const notificationIds = monitor.notifications ?? [];
			const notifications = await this.resolveNotificationsByIds(notificationIds, "handleEscalations");
			if (notifications.length === 0) {
				return;
			}
			const emailNotifications = notifications.filter((n) => n.type === "email");

			if (emailNotifications.length === 0) {
				this.logger.warn({
					message: `Monitor ${monitor.name} has escalation rules but no email notification channels`,
					service: SERVICE_NAME,
					method: "handleEscalations",
					details: {
						monitorId: monitor.id,
						notificationIds,
					},
				});
				return;
			}

			let escalationsUpdated = false;

			// Send escalation emails for each triggered threshold
			for (const rule of escalationsToSend) {
				// Build proper NotificationMessage structure for escalation
				const settings = this.settingsService.getSettings();
				const clientHost = settings.clientHost || "Host not defined";

				const escalationMessage: NotificationMessage = {
					type: "monitor_down",
					severity: "critical",
					monitor: {
						id: monitor.id,
						name: monitor.name,
						url: monitor.url,
						type: monitor.type,
						status: monitor.status,
					},
					content: {
						title: `ESCALATION: ${monitor.name}`,
						summary: `Monitor "${monitor.name}" has been down for ${downtimeMinutes} minutes`,
						details: [
							`Continuous downtime: ${downtimeMinutes} minutes`,
							`Escalation threshold: ${rule.delayMinutes} minutes`,
							`Status: Down`,
						],
						timestamp: new Date(),
						incident: {
							id: "escalation-" + monitor.id,
							url: monitor.url,
							createdAt: new Date(incidentStartTime),
							duration: `${downtimeMinutes} minutes`,
						},
					},
					clientHost,
					metadata: {
						teamId: monitor.teamId,
						notificationReason: "escalation",
					},
				};

				let sentForRule = 0;

				for (const notification of emailNotifications) {
					if (!notification.address) {
						this.logger.warn({
							message: `Email notification ${notification.id} is missing an address`,
							service: SERVICE_NAME,
							method: "handleEscalations",
						});
						continue;
					}

					try {
						const sent = await this.emailProvider.sendMessage(notification, escalationMessage);
						if (sent) {
							sentForRule += 1;
						}
					} catch (error) {
						this.logger.warn({
							message: `Failed to send escalation email for ${monitor.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
							service: SERVICE_NAME,
							method: "handleEscalations",
							details: {
								monitorId: monitor.id,
								notificationId: notification.id,
								delayMinutes: rule.delayMinutes,
							},
						});
					}
				}

				if (sentForRule > 0) {
					escalationsSent.push(rule.delayMinutes);
					escalationsUpdated = true;
				} else {
					this.logger.warn({
						message: `Escalation threshold ${rule.delayMinutes} minutes was not marked as sent because no emails were delivered`,
						service: SERVICE_NAME,
						method: "handleEscalations",
						details: {
							monitorId: monitor.id,
						},
					});
				}
			}

			if (escalationsUpdated) {
				await this.incidentsRepository.updateEscalationsSent(incident.id, escalationsSent);
			}
		} catch (error) {
			this.logger.warn({
				message: `Error in handleEscalations: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "handleEscalations",
			});
		}
	};

	sendTestNotification = async (notification: Partial<Notification>) => {
		switch (notification.type) {
			case "email":
				return await this.emailProvider.sendTestAlert(notification);
			case "slack":
				return await this.slackProvider.sendTestAlert(notification);
			case "discord":
				return await this.discordProvider.sendTestAlert(notification);
			case "pager_duty":
				return await this.pagerDutyProvider.sendTestAlert(notification);
			case "matrix":
				return await this.matrixProvider.sendTestAlert(notification);
			case "webhook":
				return await this.webhookProvider.sendTestAlert(notification);
			case "teams":
				return await this.teamsProvider.sendTestAlert(notification);
			default:
				return false;
		}
	};

	testAllNotifications = async (notificationIds: string[]) => {
		const notifications = await this.resolveNotificationsByIds(notificationIds, "testAllNotifications");
		if (notifications.length === 0) {
			return false;
		}
		const tasks = notifications.map((notification) => this.sendTestNotification(notification));
		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter(Boolean).length;
		const failed = outcomes.length - succeeded;
		if (failed > 0 || notifications.length !== notificationIds.length) {
			return false;
		}
		return true;
	};

	createNotification = async (notificationData: Partial<Notification>, userId: string, teamId: string): Promise<Notification> => {
		notificationData.userId = userId;
		notificationData.teamId = teamId;
		return await this.notificationsRepository.create(notificationData);
	};

	findById = async (id: string, teamId: string): Promise<Notification> => {
		return await this.notificationsRepository.findById(id, teamId);
	};

	findNotificationsByTeamId = async (teamId: string): Promise<Notification[]> => {
		return await this.notificationsRepository.findByTeamId(teamId);
	};

	updateById = async (id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification> => {
		return await this.notificationsRepository.updateById(id, teamId, updateData);
	};

	deleteById = async (id: string, teamId: string): Promise<Notification> => {
		const deleted = await this.notificationsRepository.deleteById(id, teamId);
		await this.monitorsRepository.removeNotificationFromMonitors(id);
		return deleted;
	};
}
