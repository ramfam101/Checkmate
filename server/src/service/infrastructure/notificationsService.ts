import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";

export interface NotificationTestResult {
	success: boolean;
	error?: string;
	details?: Record<string, unknown>;
}

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;
	sendEscalationNotification: (monitor: Monitor, channelId: string) => Promise<boolean>;
	sendEscalationRecoveryNotification: (monitor: Monitor, channelId: string) => Promise<boolean>;

	sendTestNotification: (notification: Partial<Notification>) => Promise<NotificationTestResult>;
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

		const reason = notificationMessage.metadata?.notificationReason ?? decision.notificationReason;
		this.logger.info({
			message: "Dispatching notification",
			service: SERVICE_NAME,
			method: "send",
			details: {
				reason,
				monitorId: monitor.id,
				monitorName: monitor.name,
				notificationId: notification.id,
				notificationType: notification.type,
				notificationName: notification.notificationName,
			},
		});

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

	sendEscalationNotification = async (monitor: Monitor, channelId: string) => {
		const notification = await this.notificationsRepository.findById(channelId, monitor.teamId);
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";

		this.logger.info({
			message: "Preparing escalation notification",
			service: SERVICE_NAME,
			method: "sendEscalationNotification",
			details: {
				monitorId: monitor.id,
				monitorName: monitor.name,
				escalationChannelId: channelId,
				resolvedNotificationId: notification.id,
				resolvedNotificationName: notification.notificationName,
				resolvedNotificationType: notification.type,
			},
		});

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
				title: `Escalation: ${monitor.name}`,
				summary: `Monitor "${monitor.name}" remains unresolved after the escalation delay.`,
				details: [`URL: ${monitor.url}`, `Current status: ${monitor.status}`, "Escalation triggered because incident was not resolved in time."],
				timestamp: new Date(),
			},
			clientHost,
			metadata: {
				teamId: monitor.teamId,
				notificationReason: "escalation",
			},
		};

		return this.send(
			notification,
			monitor,
			{} as MonitorStatusResponse,
			{
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "status_change",
			},
			escalationMessage
		);
	};

	sendEscalationRecoveryNotification = async (monitor: Monitor, channelId: string) => {
		const notification = await this.notificationsRepository.findById(channelId, monitor.teamId);
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";

		this.logger.info({
			message: "Preparing escalation recovery notification",
			service: SERVICE_NAME,
			method: "sendEscalationRecoveryNotification",
			details: {
				monitorId: monitor.id,
				monitorName: monitor.name,
				escalationChannelId: channelId,
				resolvedNotificationId: notification.id,
				resolvedNotificationName: notification.notificationName,
				resolvedNotificationType: notification.type,
			},
		});

		const recoveryMessage: NotificationMessage = {
			type: "monitor_up",
			severity: "success",
			monitor: {
				id: monitor.id,
				name: monitor.name,
				url: monitor.url,
				type: monitor.type,
				status: monitor.status,
			},
			content: {
				title: `Escalation Resolved: ${monitor.name}`,
				summary: `Monitor "${monitor.name}" is back up and operational.`,
				details: [`URL: ${monitor.url}`, `Current status: ${monitor.status}`, "Escalation has been resolved because the monitor recovered."],
				timestamp: new Date(),
			},
			clientHost,
			metadata: {
				teamId: monitor.teamId,
				notificationReason: "escalation_recovery",
			},
		};

		return this.send(
			notification,
			monitor,
			{} as MonitorStatusResponse,
			{
				shouldCreateIncident: false,
				shouldResolveIncident: true,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "status_change",
			},
			recoveryMessage
		);
	};

	sendTestNotification = async (notification: Partial<Notification>): Promise<NotificationTestResult> => {
		switch (notification.type) {
			case "email": {
				if (this.emailProvider.sendTestAlertWithResult) {
					return await this.emailProvider.sendTestAlertWithResult(notification);
				}

				const success = await this.emailProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "Email provider test failed" };
			}
			case "slack": {
				const success = await this.slackProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "Slack provider test failed" };
			}
			case "discord": {
				const success = await this.discordProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "Discord provider test failed" };
			}
			case "pager_duty": {
				const success = await this.pagerDutyProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "PagerDuty provider test failed" };
			}
			case "matrix": {
				const success = await this.matrixProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "Matrix provider test failed" };
			}
			case "webhook": {
				const success = await this.webhookProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "Webhook provider test failed" };
			}
			case "teams": {
				const success = await this.teamsProvider.sendTestAlert(notification);
				return success ? { success: true } : { success: false, error: "Teams provider test failed" };
			}
			default:
				return { success: false, error: `Unknown provider type: ${notification.type ?? "undefined"}` };
		}
	};

	testAllNotifications = async (notificationIds: string[]) => {
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);
		const tasks = notifications.map((notification) => this.sendTestNotification(notification));
		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter((outcome) => outcome.success).length;
		const failed = outcomes.length - succeeded;
		if (failed > 0) {
			this.logger.warn({
				message: "Some notification test checks failed",
				service: SERVICE_NAME,
				method: "testAllNotifications",
				details: {
					failed,
					total: outcomes.length,
				},
			});
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
