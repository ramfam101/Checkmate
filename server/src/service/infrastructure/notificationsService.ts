import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { IEscalationScheduler, EscalationContext } from "@/service/infrastructure/escalationScheduler.js";
import { escalationLog } from "@/utils/escalationLogger.js";

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;
	scheduleEscalations: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<void>;

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
	private escalationScheduler: IEscalationScheduler;

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
		escalationScheduler: IEscalationScheduler
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
		this.escalationScheduler = escalationScheduler;
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

	scheduleEscalations = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision): Promise<void> => {
			// Use escalationNotifications array, not regular notifications array
			const notificationIds = monitor.escalationNotifications ?? [];

			escalationLog.pipelineStart(monitor.id, notificationIds.length);
			this.logger.info({
				message: `[ESCALATION SCHEDULER] scheduleEscalations invoked for monitor ${monitor.id} with escalationNotifications=${notificationIds.length}`,
				service: SERVICE_NAME,
				method: "scheduleEscalations",
			});

			if (notificationIds.length === 0) {
				return;
			}

		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		this.logger.info({
			message: `[ESCALATION SCHEDULER] Fetched ${notifications.length} notifications: ${notifications.map((n) => `{id: ${n.id}, escalationDelayMs: ${n.escalationDelayMs}}`).join(", ")}`,
			service: SERVICE_NAME,
			method: "scheduleEscalations",
		});

		// Filter for notifications that have escalationDelayMs set
		const escalatingNotifications = notifications.filter((n) => n.escalationDelayMs !== undefined && n.escalationDelayMs >= 0);

		if (escalatingNotifications.length === 0) {
			escalationLog.noEligibleNotifications(monitor.id, notifications.length);
			this.logger.info({
				message: `No escalation-enabled notifications found for monitor ${monitor.id} (fetched ${notifications.length}, none had escalationDelayMs >= 0)`,
				service: SERVICE_NAME,
				method: "scheduleEscalations",
			});
			return;
		}

		this.logger.info({
			message: `[ESCALATION SCHEDULER] ${escalatingNotifications.length} notifications will be escalated: ${escalatingNotifications.map((n) => `{id: ${n.id}, delayMs: ${n.escalationDelayMs}}`).join(", ")}`,
			service: SERVICE_NAME,
			method: "scheduleEscalations",
		});

		// Schedule each escalation with a callback to send it
			for (const notification of escalatingNotifications) {
				const delayMs = notification.escalationDelayMs!;

				this.logger.info({
					message: `[ESCALATION SCHEDULER] Scheduling escalation for notification ${notification.id} with delayMs=${delayMs} on monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "scheduleEscalations",
				});

				try {
					await this.escalationScheduler.scheduleEscalation(
						notification,
						monitor,
						monitorStatusResponse,
						decision,
						delayMs,
						this.handleEscalationReady
					);
				} catch (error: unknown) {
					this.logger.error({
						message: `Error scheduling escalation for notification ${notification.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "scheduleEscalations",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
	};

	private handleEscalationReady = async (context: EscalationContext): Promise<void> => {
		escalationLog.callbackInvoked(context.monitor.id, context.notification.id, context.notification.type);
		this.logger.info({
			message: `[ESCALATION CALLBACK] handleEscalationReady invoked for monitor ${context.monitor.id}, notification ${context.notification.id}`,
			service: SERVICE_NAME,
			method: "handleEscalationReady",
		});

		try {
			// Build message with escalation prefix
			const settings = this.settingsService.getSettings();
			const clientHost = settings.clientHost || "Host not defined";

			const notificationMessage = this.notificationMessageBuilder.buildMessage(
				context.monitor,
				context.monitorStatusResponse,
				context.decision,
				clientHost,
				true // isEscalation = true
			);

			escalationLog.sendAttempt(context.monitor.id, context.notification.id, context.notification.type);
			this.logger.debug({
				message: `[ESCALATION] About to call send() with notification type: ${context.notification.type}`,
				service: SERVICE_NAME,
				method: "handleEscalationReady",
			});

			// Send the escalation notification
			const sendResult = await this.send(context.notification, context.monitor, context.monitorStatusResponse, context.decision, notificationMessage);

			escalationLog.sendResult(context.monitor.id, context.notification.id, sendResult);
			this.logger.debug({
				message: `[ESCALATION] send() returned: ${sendResult}`,
				service: SERVICE_NAME,
				method: "handleEscalationReady",
			});

			if (!sendResult) {
				this.logger.warn({
					message: `Escalation notification FAILED for monitor ${context.monitor.id}, notification ${context.notification.id}`,
					service: SERVICE_NAME,
					method: "handleEscalationReady",
				});
				return;
			}

			this.logger.info({
				message: `Escalation notification sent for monitor ${context.monitor.id}, notification ${context.notification.id}`,
				service: SERVICE_NAME,
				method: "handleEscalationReady",
			});
		} catch (error: unknown) {
			const errMsg = error instanceof Error ? error.message : "Unknown error";
			escalationLog.error(context.monitor.id, context.notification.id, errMsg);
			this.logger.error({
				message: `Error sending escalation notification: ${errMsg}`,
				service: SERVICE_NAME,
				method: "handleEscalationReady",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};
}

