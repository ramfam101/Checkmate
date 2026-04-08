import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import { AppError } from "@/utils/AppError.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;
	handleEscalationNotification: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}

const SERVICE_NAME = "NotificationsService";

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
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

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
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		// Send notifications based on decision
		return await this.sendNotifications(monitor, monitorStatusResponse, decision);
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
		const foundNotificationIds = new Set(notifications.map((notification) => notification.id));
		const missingNotificationIds = notificationIds.filter((id) => !foundNotificationIds.has(id));

		if (missingNotificationIds.length > 0) {
			this.logger.warn({
				message: `Some notifications could not be found for test`,
				service: SERVICE_NAME,
				method: "testAllNotifications",
				details: { missingNotificationIds },
			});
			throw new AppError({
				message: `Notifications not found for IDs: ${missingNotificationIds.join(", ")}`,
				status: 500,
				service: SERVICE_NAME,
				method: "testAllNotifications",
			});
		}

		const results = await Promise.all(
			notifications.map(async (notification) => ({
				notification,
				success: await this.sendTestNotification(notification),
			}))
		);

		const failedNotifications = results.filter((result) => !result.success).map((result) => ({
			id: result.notification.id,
			name: result.notification.notificationName,
			type: result.notification.type,
		}));

		if (failedNotifications.length > 0) {
			this.logger.warn({
				message: "Failed to send some test notifications",
				service: SERVICE_NAME,
				method: "testAllNotifications",
				details: { failedNotifications },
			});
			throw new AppError({
				message: `Failed to send test notifications for: ${failedNotifications.map((n) => n.name).join(", ")}`,
				status: 500,
				service: SERVICE_NAME,
				method: "testAllNotifications",
				details: { failedNotifications },
			});
		}

		return true;
	};

	private sendEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const notificationIds = monitor.escalationTargets ?? [];
		if (notificationIds.length === 0) {
			this.logger.debug({
				message: "No escalation targets configured for monitor escalation",
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
				details: { monitorId: monitor.id },
			});
			return true;
		}

		const escalationNotifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		const tasks = escalationNotifications.map((notification) =>
			this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage)
		);

		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter(Boolean).length;
		const failed = outcomes.length - succeeded;

		if (failed > 0) {
			this.logger.warn({
				message: `Escalation notification send completed with ${succeeded} success, ${failed} failure(s)`,
				service: SERVICE_NAME,
				method: "sendEscalationNotifications",
			});
		}

		return succeeded === escalationNotifications.length;
	};

	handleEscalationNotification = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		// Only send escalation if monitor is currently down
		if (monitor.status !== "down") {
			this.logger.debug({
				message: "Monitor is not in down state, skipping escalation notification",
				service: SERVICE_NAME,
				method: "handleEscalationNotification",
				details: { monitorId: monitor.id, status: monitor.status },
			});
			return false;
		}

		return await this.sendEscalationNotifications(monitor, monitorStatusResponse, decision);
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
