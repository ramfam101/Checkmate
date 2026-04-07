import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import MonitorNotificationDispatchStateRepository from "@/repositories/notifications/MonitorNotificationDispatchStateRepository.js";

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
	private monitorNotificationDispatchStateRepository: MonitorNotificationDispatchStateRepository;
	private readonly MS_PER_MINUTE = 60 * 1000;

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
		this.monitorNotificationDispatchStateRepository = new MonitorNotificationDispatchStateRepository();
	}

	private getEscalationIntervalMs = (monitor: Monitor): number | null => {
		const escalationTimeMinutes = Number(monitor.escalationTime);
		if (!escalationTimeMinutes || escalationTimeMinutes <= 0) {
			return null;
		}
		return escalationTimeMinutes * this.MS_PER_MINUTE;
	};

	private getEscalationNotificationIds = (monitor: Monitor): string[] => {
		return monitor.escalationChannels ?? [];
	};

	private initializeEscalationWindow = async (monitor: Monitor): Promise<void> => {
		const intervalMs = this.getEscalationIntervalMs(monitor);
		const escalationNotificationIds = this.getEscalationNotificationIds(monitor);
		if (!intervalMs || escalationNotificationIds.length === 0) {
			return;
		}

		const dispatchStates = await Promise.all(
			escalationNotificationIds.map((notificationId) =>
				this.monitorNotificationDispatchStateRepository.findByMonitorAndNotification(monitor.teamId, monitor.id, notificationId)
			)
		);

		const missingStateNotificationIds = escalationNotificationIds.filter((_, index) => !dispatchStates[index]?.lastSentAt);

		if (missingStateNotificationIds.length === 0) {
			return;
		}

		const now = new Date();
		await Promise.all(
			missingStateNotificationIds.map((notificationId) =>
				this.monitorNotificationDispatchStateRepository.upsertLastSentAt(monitor.userId, monitor.teamId, monitor.id, notificationId, now)
			)
		);
	};

	private shouldSendEscalationNotification = async (monitor: Monitor, notification: Notification): Promise<boolean> => {
		if (monitor.status !== "down") {
			return false;
		}

		const escalationNotificationIds = this.getEscalationNotificationIds(monitor);
		if (!escalationNotificationIds.includes(notification.id)) {
			return false;
		}

		const intervalMs = this.getEscalationIntervalMs(monitor);
		if (!intervalMs) {
			return false;
		}

		const dispatchState = await this.monitorNotificationDispatchStateRepository.findByMonitorAndNotification(
			monitor.teamId,
			monitor.id,
			notification.id
		);
		if (!dispatchState?.lastSentAt) {
			await this.monitorNotificationDispatchStateRepository.upsertLastSentAt(monitor.userId, monitor.teamId, monitor.id, notification.id, new Date());
			return false;
		}

		const elapsedMs = Date.now() - new Date(dispatchState.lastSentAt).getTime();
		return elapsedMs >= intervalMs;
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

	private sendNotifications = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		notificationIds: string[],
		isEscalation: boolean
	) => {
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		if (notifications.length === 0) {
			return true;
		}

		// Build notification message once for all notifications
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const baseNotificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);
		const notificationMessage = isEscalation
			? {
					...baseNotificationMessage,
					metadata: {
						...baseNotificationMessage.metadata,
						isEscalation: true,
					},
				}
			: baseNotificationMessage;

		const sendFlags = isEscalation
			? await Promise.all(notifications.map((notification) => this.shouldSendEscalationNotification(monitor, notification)))
			: notifications.map(() => true);
		const notificationsToSend = notifications.filter((_, index) => sendFlags[index]);

		if (notificationsToSend.length === 0) {
			if (isEscalation) {
				await this.initializeEscalationWindow(monitor);
			}
			return true;
		}

		const tasks = notificationsToSend.map(async (notification) => {
			const sent = await this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage);
			if (sent) {
				await this.monitorNotificationDispatchStateRepository.upsertLastSentAt(
					notification.userId,
					monitor.teamId,
					monitor.id,
					notification.id,
					new Date()
				);
			}
			return sent;
		});

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

		if (isEscalation) {
			await this.initializeEscalationWindow(monitor);
		}
		// Return true if all notifications succeeded
		return succeeded === notificationsToSend.length;
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification && monitor.status !== "down") {
			return false;
		}

		if (monitor.status === "up") {
			await this.monitorNotificationDispatchStateRepository.clearByMonitor(monitor.teamId, monitor.id);
		}

		if (decision.shouldSendNotification) {
			const result = await this.sendNotifications(monitor, monitorStatusResponse, decision, monitor.notifications ?? [], false);
			if (monitor.status === "down") {
				await this.initializeEscalationWindow(monitor);
			}
			return result;
		}

		// Ongoing downtime without a new status transition:
		// if primary notifications were never sent for this outage, send them once.
		const primaryNotificationIds = monitor.notifications ?? [];
		if (primaryNotificationIds.length > 0) {
			const primaryDispatchStates = await Promise.all(
				primaryNotificationIds.map((notificationId) =>
					this.monitorNotificationDispatchStateRepository.findByMonitorAndNotification(monitor.teamId, monitor.id, notificationId)
				)
			);

			const unsentPrimaryNotificationIds = primaryNotificationIds.filter((_, index) => !primaryDispatchStates[index]?.lastSentAt);

			if (unsentPrimaryNotificationIds.length > 0) {
				const result = await this.sendNotifications(monitor, monitorStatusResponse, decision, unsentPrimaryNotificationIds, false);
				await this.initializeEscalationWindow(monitor);
				return result;
			}
		}

		// Ongoing downtime: evaluate escalation channels only.
		return await this.sendNotifications(monitor, monitorStatusResponse, decision, this.getEscalationNotificationIds(monitor), true);
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
