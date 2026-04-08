import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IIncidentsRepository, IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import Scheduler from "super-simple-scheduler";

type EscalationJobData = {
	monitorId: string;
	teamId: string;
	monitorStatusResponse: MonitorStatusResponse;
	decision: MonitorActionDecision;
	escalationDelayMinutes: number;
	clientHost: string;
};

export interface INotificationsService {
	init: () => Promise<void>;
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
	private incidentsRepository: IIncidentsRepository;
	private logger: ILogger;
	private settingsService: ISettingsService;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private escalationScheduler: Scheduler;

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
		incidentsRepository: IIncidentsRepository,
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
		this.incidentsRepository = incidentsRepository;
		this.settingsService = settingsService;
		this.logger = logger;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.escalationScheduler = new Scheduler({ logLevel: "error" });
	}

	init = async () => {
		await this.escalationScheduler.start();
		await this.escalationScheduler.addTemplate("escalation-notification", async (data?: EscalationJobData) => {
			if (!data) {
				return false;
			}
			return await this.sendEscalationNotification(data);
		});
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

	private sendToNotifications = async (
		notificationIds: string[],
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		notificationMessage: NotificationMessage | undefined
	) => {
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);
		const tasks = notifications.map((notification) => this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage));
		const outcomes = await Promise.all(tasks);
		const succeeded = outcomes.filter(Boolean).length;
		const failed = outcomes.length - succeeded;
		if (failed > 0) {
			this.logger.warn({
				message: `Notification send completed with ${succeeded} success, ${failed} failure(s)`,
				service: SERVICE_NAME,
				method: "sendToNotifications",
			});
		}
		return succeeded === notifications.length;
	};

	private sendNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const notificationIds = monitor.notifications ?? [];
		// Build notification message once for all notifications
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		return await this.sendToNotifications(notificationIds, monitor, monitorStatusResponse, decision, notificationMessage);
	};

	private scheduleEscalationNotification = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<void> => {
		const escalationDelayMinutes = monitor.escalationDelayMinutes ?? 0;
		const escalationNotificationIds = monitor.escalationNotifications ?? [];

		if (monitor.status !== "down" || escalationDelayMinutes <= 0 || escalationNotificationIds.length === 0) {
			return;
		}

		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const scheduledAt = Date.now() + escalationDelayMinutes * 60 * 1000;

		await this.escalationScheduler.addJob({
			id: `escalation-${monitor.id}`,
			template: "escalation-notification",
			startAt: scheduledAt,
			data: {
				monitorId: monitor.id,
				teamId: monitor.teamId,
				monitorStatusResponse,
				decision,
				escalationDelayMinutes,
				clientHost,
			} satisfies EscalationJobData,
		});
	};

	private clearEscalationNotification = async (monitorId: string): Promise<void> => {
		this.escalationScheduler.removeJob(`escalation-${monitorId}`);
	};

	private sendEscalationNotification = async (data: EscalationJobData): Promise<boolean> => {
		try {
			const monitor = await this.monitorsRepository.findById(data.monitorId, data.teamId);
			if (monitor.status !== "down") {
				return false;
			}

			const activeIncident = await this.incidentsRepository.findActiveByMonitorId(data.monitorId, data.teamId);
			if (!activeIncident) {
				return false;
			}

			const incidentStartAt = new Date(activeIncident.startTime).getTime();
			if (Number.isNaN(incidentStartAt)) {
				return false;
			}

			const escalationDelayMinutes = monitor.escalationDelayMinutes ?? data.escalationDelayMinutes;
			const escalationDelayMs = escalationDelayMinutes * 60 * 1000;
			const elapsedDownMs = Date.now() - incidentStartAt;

			// Ensure escalation is sent only after the monitor has been down for the configured duration.
			if (elapsedDownMs < escalationDelayMs) {
				await this.escalationScheduler.addJob({
					id: `escalation-${monitor.id}`,
					template: "escalation-notification",
					startAt: incidentStartAt + escalationDelayMs,
					data: {
						...data,
						escalationDelayMinutes,
					},
				});
				return false;
			}

			const escalationNotificationIds = monitor.escalationNotifications ?? [];
			if (escalationNotificationIds.length === 0) {
				return false;
			}

			const escalationMessage = this.notificationMessageBuilder.buildMessage(monitor, data.monitorStatusResponse, data.decision, data.clientHost, {
				escalated: true,
			});

			return await this.sendToNotifications(escalationNotificationIds, monitor, data.monitorStatusResponse, data.decision, escalationMessage);
		} catch (error: unknown) {
			this.logger.warn({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		// Send notifications based on decision
		const sent = await this.sendNotifications(monitor, monitorStatusResponse, decision);

		if (monitor.status === "down" && decision.notificationReason === "status_change") {
			await this.scheduleEscalationNotification(monitor, monitorStatusResponse, decision).catch((error: unknown) => {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "scheduleEscalationNotification",
					stack: error instanceof Error ? error.stack : undefined,
				});
			});
		}

		if (monitor.status === "up" && decision.notificationReason === "status_change") {
			await this.clearEscalationNotification(monitor.id);
		}

		return sent;
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
