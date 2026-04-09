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
	handleEscalationNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse) => Promise<boolean>;

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
		return { succeeded, total: notifications.length };
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		// Send notifications based on decision
		const result = await this.sendNotifications(monitor, monitorStatusResponse, decision);

		// Initial down/breached alerts should start the escalation interval clock.
		if (result.succeeded > 0 && !decision.isEscalation && (monitor.status === "down" || monitor.status === "breached")) {
			try {
				await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
					lastEscalationEmailSentAt: new Date(),
				});
			} catch (error: unknown) {
				this.logger.warn({
					message: `Failed to set lastEscalationEmailSentAt for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleNotifications",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		}

		return result.succeeded === result.total;
	};

	handleEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse) => {
		const currentMonitor = await this.monitorsRepository.findById(monitor.id, monitor.teamId);
		if (!currentMonitor) {
			this.logger.warn({
				message: `Monitor ${monitor.id} not found for escalation notifications`,
				service: SERVICE_NAME,
				method: "handleEscalationNotifications",
			});
			return false;
		}

		// Only escalate if monitor is down/breached and escalation is configured
		if (currentMonitor.status !== "down" && currentMonitor.status !== "breached") {
			return false;
		}

		const escalationDelayMinutes = currentMonitor.escalation?.delayMinutes ?? currentMonitor.escalationEmailFrequency;
		const legacyEscalationNotificationIds = currentMonitor.escalationNotifications ?? [];
		const escalationChannelId =
			currentMonitor.escalation?.channelId ?? currentMonitor.escalationNotificationChannel ?? legacyEscalationNotificationIds[0];

		if (!escalationDelayMinutes || escalationDelayMinutes <= 0 || !escalationChannelId) {
			return false;
		}

		const escalationNotificationIds =
			currentMonitor.escalation?.channelId || currentMonitor.escalationNotificationChannel ? [escalationChannelId] : legacyEscalationNotificationIds;
		const now = new Date();
		const escalationIntervalMs = escalationDelayMinutes * 60 * 1000;
		const lastEscalationSentAt = currentMonitor.lastEscalationEmailSentAt ? new Date(currentMonitor.lastEscalationEmailSentAt) : null;

		if (!lastEscalationSentAt) {
			try {
				await this.monitorsRepository.updateById(currentMonitor.id, currentMonitor.teamId, {
					lastEscalationEmailSentAt: now,
				});
			} catch (error: unknown) {
				this.logger.warn({
					message: `Failed to initialize escalation timestamp for monitor ${currentMonitor.id}`,
					service: SERVICE_NAME,
					method: "handleEscalationNotifications",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
			return false;
		}

		const timeSinceLastEscalation = now.getTime() - lastEscalationSentAt.getTime();
		if (timeSinceLastEscalation < escalationIntervalMs) {
			return false; // Not enough time has passed
		}

		// Get escalation notifications
		const notifications = await this.notificationsRepository.findNotificationsByIds(escalationNotificationIds);
		if (notifications.length === 0) {
			return false;
		}

		// Build decision for escalation with isEscalation flag
		const escalationDecision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: null,
			notificationReason: "status_change",
			isEscalation: true,
		};

		// Build notification message for escalation
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(currentMonitor, monitorStatusResponse, escalationDecision, clientHost);

		// Send escalation notifications
		const tasks = notifications.map((notification) =>
			this.send(notification, currentMonitor, monitorStatusResponse, escalationDecision, notificationMessage)
		);

		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter(Boolean).length;

		// Update monitor with last escalation time if at least one succeeded
		if (succeeded > 0) {
			try {
				await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
					lastEscalationEmailSentAt: now,
				});
			} catch (error: unknown) {
				this.logger.warn({
					message: `Failed to update lastEscalationEmailSentAt for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleEscalationNotifications",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		}

		return succeeded === notifications.length;
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
