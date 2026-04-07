import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
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
const MINUTE_IN_MS = 60 * 1000;

export class NotificationsService implements INotificationsService {
	static SERVICE_NAME = SERVICE_NAME;

	private notificationsRepository: INotificationsRepository;
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
		const { succeeded, total } = await this.sendNotificationsByIds(notificationIds, monitor, monitorStatusResponse, decision);

		// Return true if all notifications succeeded
		return total > 0 && succeeded === total;
	};

	private sendNotificationsByIds = async (
		notificationIds: string[],
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		isEscalation: boolean = false
	): Promise<{ succeeded: number; total: number }> => {
		if (!notificationIds.length) {
			return { succeeded: 0, total: 0 };
		}

		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		// Build notification message once for all notifications
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost, isEscalation);

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

		return { succeeded, total: notifications.length };
	};

	private getCurrentIncidentStartedAt = (monitor: Monitor): string | null => {
		if (monitor.currentIncidentStartedAt) {
			return monitor.currentIncidentStartedAt;
		}

		const recentChecks = monitor.recentChecks ?? [];
		if (!recentChecks.length) {
			return null;
		}

		let incidentStart: string | null = null;
		for (let i = recentChecks.length - 1; i >= 0; i -= 1) {
			const check = recentChecks[i];
			if (!check) {
				continue;
			}
			if (!check.status) {
				incidentStart = check.createdAt;
				continue;
			}
			break;
		}

		return incidentStart;
	};

	private shouldSendEscalation = (monitor: Monitor, incidentStartedAt: string): boolean => {
		const escalateAfterMinutes = monitor.escalateAfterMinutes ?? 0;
		if (escalateAfterMinutes <= 0) {
			return false;
		}

		const downSinceMs = new Date(incidentStartedAt).getTime();
		if (!Number.isFinite(downSinceMs)) {
			return false;
		}

		const downDurationMs = Date.now() - downSinceMs;
		const escalationThresholdMs = escalateAfterMinutes * MINUTE_IN_MS;
		if (downDurationMs < escalationThresholdMs) {
			return false;
		}

		return monitor.lastEscalatedIncidentStartedAt !== incidentStartedAt;
	};

	private handleEscalationNotifications = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<boolean> => {
		if (monitor.status !== "down") {
			if (monitor.currentIncidentStartedAt || monitor.lastEscalatedIncidentStartedAt) {
				await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
					currentIncidentStartedAt: null,
					lastEscalatedIncidentStartedAt: null,
				});
			}
			return false;
		}

		let incidentStartedAt = this.getCurrentIncidentStartedAt(monitor);
		if (!incidentStartedAt) {
			incidentStartedAt = new Date().toISOString();
		}

		if (monitor.currentIncidentStartedAt !== incidentStartedAt) {
			await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
				currentIncidentStartedAt: incidentStartedAt,
			});
		}

		if (!this.shouldSendEscalation(monitor, incidentStartedAt)) {
			return false;
		}

		const escalationNotificationIds = monitor.escalationNotifications ?? [];
		const { succeeded, total } = await this.sendNotificationsByIds(escalationNotificationIds, monitor, monitorStatusResponse, decision, true);
		if (total === 0 || succeeded === 0) {
			return false;
		}

		await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
			currentIncidentStartedAt: incidentStartedAt,
			lastEscalatedIncidentStartedAt: incidentStartedAt,
		});

		return true;
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		let sentStandardNotifications = false;
		if (decision.shouldSendNotification) {
			// Send regular notifications based on status-change/threshold decision
			sentStandardNotifications = await this.sendNotifications(monitor, monitorStatusResponse, decision);
		}

		const sentEscalationNotifications = await this.handleEscalationNotifications(monitor, monitorStatusResponse, decision);

		return sentStandardNotifications || sentEscalationNotifications;
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
