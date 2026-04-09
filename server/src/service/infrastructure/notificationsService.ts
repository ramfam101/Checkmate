import type { Incident, Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IIncidentsRepository, IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
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

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}

const SERVICE_NAME = "NotificationsService";

export class NotificationsService implements INotificationsService {
	static SERVICE_NAME = SERVICE_NAME;

	private notificationsRepository: INotificationsRepository;
	private monitorsRepository: IMonitorsRepository;
	private incidentsRepository: IIncidentsRepository;
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
		monitorsRepository: IMonitorsRepository,
		incidentsRepository: IIncidentsRepository,
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
		this.monitorsRepository = monitorsRepository;
		this.incidentsRepository = incidentsRepository;
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
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		if (!notifications.length) {
			return true;
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
			});
		}
		// Return true if all notifications succeeded
		return succeeded === notifications.length;
	}

	private getElapsedMinutesFromIncident(incident: Incident): number {
		const startTimeMs = new Date(incident.startTime).getTime();
		if (Number.isNaN(startTimeMs)) {
			return 0;
		}
		return Math.floor((Date.now() - startTimeMs) / 60000);
	}

	private sendEscalationNotifications = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<boolean> => {
		const escalationAfterMinutes = Number(monitor.escalationAfterMinutes ?? 0);
		const escalationNotificationIds = [...new Set(monitor.escalationNotifications ?? [])];

		if (!Number.isFinite(escalationAfterMinutes) || escalationAfterMinutes <= 0 || escalationNotificationIds.length === 0) {
			return false;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return false;
		}

		const elapsedMinutes = this.getElapsedMinutesFromIncident(activeIncident);
		if (elapsedMinutes < escalationAfterMinutes) {
			return false;
		}

		const notifications = await this.notificationsRepository.findNotificationsByIds(escalationNotificationIds);
		if (!notifications.length) {
			return false;
		}

		const escalationProgress = activeIncident.escalationProgress ?? {};
		const notificationsToSend: Notification[] = [];
		const nextEscalationProgress: Record<string, number> = { ...escalationProgress };

		for (const notification of notifications) {
			if (!notification.id) {
				continue;
			}

			const alreadySent = escalationProgress[notification.id] !== undefined;
			if (alreadySent) {
				continue;
			}

			this.logger.debug({
				message: "Escalation notification is due",
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
				details: {
					monitorId: monitor.id,
					notificationId: notification.id,
					notificationType: notification.type,
					elapsedMinutes,
						escalationAfterMinutes,
				},
			});

			notificationsToSend.push(notification);
			nextEscalationProgress[notification.id] = 0;
		}

		if (!notificationsToSend.length) {
			return false;
		}

		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const baseNotificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);
		const notificationMessage: NotificationMessage = {
			...baseNotificationMessage,
			metadata: {
				...baseNotificationMessage.metadata,
				notificationReason: "escalation",
			},
		};

		const outcomes = await Promise.all(
			notificationsToSend.map(async (notification) => ({
				notification,
				success: await this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage),
			}))
		);

		const succeeded = outcomes.filter((outcome) => outcome.success).length;
		for (const outcome of outcomes) {
			if (!outcome.success || !outcome.notification.id) {
				continue;
			}
			const progressedToIndex = nextEscalationProgress[outcome.notification.id];
			if (progressedToIndex !== undefined) {
				escalationProgress[outcome.notification.id] = progressedToIndex;
			}
		}

		if (succeeded > 0) {
			await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
				escalationProgress,
			});
		}

		const allSucceeded = succeeded === notificationsToSend.length;
		if (!allSucceeded) {
			const failedNotifications = outcomes
				.filter((outcome) => !outcome.success)
				.map((outcome) => ({
					notificationId: outcome.notification.id,
					notificationType: outcome.notification.type,
					address: outcome.notification.address,
				}));

			this.logger.warn({
				message: `Escalation notification send completed with ${succeeded} success, ${notificationsToSend.length - succeeded} failure(s)`,
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
				details: {
					monitorId: monitor.id,
					incidentId: activeIncident.id,
					failedNotifications,
				},
			});
		}

		return allSucceeded;
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const shouldTryEscalation = !decision.shouldSendNotification && (monitor.status === "down" || monitor.status === "breached");

		if (decision.shouldSendNotification) {
			return await this.sendNotifications(monitor, monitorStatusResponse, decision);
		}

		if (shouldTryEscalation) {
			return await this.sendEscalationNotifications(monitor, monitorStatusResponse, decision);
		}

		return false;
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
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);
		const tasks = notifications.map((notification) => this.sendTestNotification(notification));
		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter(Boolean).length;
		const failed = outcomes.length - succeeded;
		if (failed > 0) {
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
