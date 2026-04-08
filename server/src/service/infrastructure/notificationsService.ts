import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
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

	private buildEscalationMessage = (
		notificationMessage: NotificationMessage,
		monitor: Monitor,
		delayMinutes: number
	): NotificationMessage => {
		const escalationLabel = `Escalation after ${delayMinutes} minute${delayMinutes === 1 ? "" : "s"}`;
		const titlePrefix =
			notificationMessage.type === "threshold_breach" ? "Threshold escalation" : "Monitor down escalation";
		const title = `${titlePrefix}: ${monitor.name}`;
		const summary =
			notificationMessage.type === "threshold_breach"
				? `Monitor "${monitor.name}" is still breaching thresholds after ${delayMinutes} minute${delayMinutes === 1 ? "" : "s"}.`
				: `Monitor "${monitor.name}" is still down after ${delayMinutes} minute${delayMinutes === 1 ? "" : "s"}.`;

		return {
			...notificationMessage,
			content: {
				...notificationMessage.content,
				title,
				summary,
				details: [escalationLabel, ...(notificationMessage.content.details ?? [])],
			},
			metadata: {
				...notificationMessage.metadata,
				notificationReason: "escalation",
			},
		};
	};

	private sendEscalationNotifications = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<boolean> => {
		if (!monitor.escalationEnabled || !monitor.escalationNotificationId) {
			return false;
		}

		const intervals = [...(monitor.escalationIntervals ?? [])]
			.filter((value) => Number.isFinite(value) && value > 0)
			.filter((value, index, array) => array.indexOf(value) === index)
			.sort((a, b) => a - b);
		if (intervals.length === 0) {
			return false;
		}

		const maxEscalationAlerts = Math.max(1, Math.min(monitor.maxEscalationAlerts ?? 1, intervals.length));
		const limitedIntervals = intervals.slice(0, maxEscalationAlerts);
		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident?.startTime) {
			return false;
		}

		const elapsedMs = Date.now() - new Date(activeIncident.startTime).getTime();
		if (elapsedMs < 0) {
			return false;
		}

		const alreadySent = new Set(activeIncident.escalationNotificationsSent ?? []);
		const dueIntervals = limitedIntervals.filter(
			(intervalMinutes) => elapsedMs >= intervalMinutes * 60 * 1000 && !alreadySent.has(intervalMinutes)
		);
		if (dueIntervals.length === 0) {
			return false;
		}

		const escalationNotification = await this.notificationsRepository.findById(
			monitor.escalationNotificationId,
			monitor.teamId
		);
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const baseMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);
		const outcomes = await Promise.all(
			dueIntervals.map((intervalMinutes) =>
				this.send(
					escalationNotification,
					monitor,
					monitorStatusResponse,
					decision,
					this.buildEscalationMessage(baseMessage, monitor, intervalMinutes)
				)
			)
		);

		const sentIntervals = dueIntervals.filter((_: number, index: number) => outcomes[index]);
		if (sentIntervals.length === 0) {
			return false;
		}

		await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
			escalationNotificationsSent: [...alreadySent, ...sentIntervals].sort((a, b) => a - b),
		});

		return outcomes.every(Boolean);
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		let sentPrimaryNotification = false;
		if (decision.shouldSendNotification) {
			sentPrimaryNotification = await this.sendNotifications(monitor, monitorStatusResponse, decision);
		}

		const shouldCheckEscalation = monitor.status === "down" || monitor.status === "breached";
		if (!shouldCheckEscalation) {
			return sentPrimaryNotification;
		}

		const sentEscalationNotification = await this.sendEscalationNotifications(
			monitor,
			monitorStatusResponse,
			decision
		);

		return sentPrimaryNotification || sentEscalationNotification;
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
