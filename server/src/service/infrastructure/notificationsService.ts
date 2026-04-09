import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { IEscalationJobQueue } from "./escalationJobQueue.js";

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;
	sendNotification: (teamId: string, notificationId: string, type: string, data: any) => Promise<boolean>;

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
	private escalationJobQueue: IEscalationJobQueue | null;

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
		notificationMessageBuilder: INotificationMessageBuilder,
		escalationJobQueue?: IEscalationJobQueue
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
		this.escalationJobQueue = escalationJobQueue || null;
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

		// Send immediate notifications based on decision
		const immediateResult = await this.sendNotifications(monitor, monitorStatusResponse, decision);

		// Schedule escalation notifications if monitor went down and has escalation configurations
		if (monitor.status === "down" && monitor.escalations && monitor.escalations.notificationIds.length > 0 && this.escalationJobQueue) {
			try {
				this.logger.info({
					message: `[NOTIFICATION DEBUG] Scheduling escalations for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleNotifications",
					details: {
						escalationDelay: monitor.escalations.delayMinutes,
						escalationNotificationIds: monitor.escalations.notificationIds,
					},
				});
				await this.scheduleEscalationNotifications(monitor, monitorStatusResponse);
			} catch (error: unknown) {
				this.logger.error({
					message: `Error scheduling escalation notifications for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
					service: SERVICE_NAME,
					method: "handleNotifications",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		}

		return immediateResult;
	};

	sendNotification = async (teamId: string, notificationId: string, type: string, data: any) => {
		const notification = await this.notificationsRepository.findById(notificationId, teamId);
		if (!notification) {
			this.logger.warn({
				message: `Notification ${notificationId} not found`,
				service: SERVICE_NAME,
				method: "sendNotification",
			});
			return false;
		}

		// Get the monitor from the repository
		const monitor = await this.monitorsRepository.findById(data.monitorId, teamId);
		if (!monitor) {
			this.logger.warn({
				message: `Monitor ${data.monitorId} not found`,
				service: SERVICE_NAME,
				method: "sendNotification",
			});
			return false;
		}

		// Create a mock monitor status response for escalation notifications
		const monitorStatusResponse = {
			monitorId: data.monitorId,
			teamId,
			type: monitor.type,
			status: false,
			code: 0,
			message: data.escalationDelay || "Escalation notification",
		};

		const decision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: null,
			notificationReason: type === "monitor_escalation" ? "escalation" : "status_change",
		};

		// Build notification message
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		return this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage);
	};

	private scheduleEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse) => {
		if (!this.escalationJobQueue) {
			this.logger.warn({
				message: "Escalation job queue not available, skipping escalation scheduling",
				service: SERVICE_NAME,
				method: "scheduleEscalationNotifications",
			});
			return;
		}

		if (monitor.escalations.notificationIds.length === 0) {
			return;
		}

		this.logger.info({
			message: `Scheduling escalation notification for monitor ${monitor.id} with ${monitor.escalations.delayMinutes} minute delay`,
			service: SERVICE_NAME,
			method: "scheduleEscalationNotifications",
			details: { escalationDelay: monitor.escalations.delayMinutes, notificationIds: monitor.escalations.notificationIds },
		});

		// Schedule escalation job for this monitor's escalation configuration
		await this.escalationJobQueue.scheduleEscalation(
			monitor.id,
			monitor.teamId,
			monitor.escalations.delayMinutes,
			monitor.escalations.notificationIds
		);
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
