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
	static readonly SERVICE_NAME = SERVICE_NAME;

	private readonly notificationsRepository: INotificationsRepository;
	private readonly monitorsRepository: IMonitorsRepository;
	private readonly incidentsRepository: IIncidentsRepository;
	private readonly webhookProvider: INotificationProvider;
	private readonly emailProvider: INotificationProvider;
	private readonly slackProvider: INotificationProvider;
	private readonly discordProvider: INotificationProvider;
	private readonly pagerDutyProvider: INotificationProvider;
	private readonly matrixProvider: INotificationProvider;
	private readonly teamsProvider: INotificationProvider;
	private readonly logger: ILogger;
	private readonly settingsService: ISettingsService;
	private readonly notificationMessageBuilder: INotificationMessageBuilder;

	constructor({
		notificationsRepository,
		monitorsRepository,
		incidentsRepository,
		webhookProvider,
		emailProvider,
		slackProvider,
		discordProvider,
		pagerDutyProvider,
		matrixProvider,
		teamsProvider,
		settingsService,
		logger,
		notificationMessageBuilder,
	}: {
		notificationsRepository: INotificationsRepository;
		monitorsRepository: IMonitorsRepository;
		incidentsRepository: IIncidentsRepository;
		webhookProvider: INotificationProvider;
		emailProvider: INotificationProvider;
		slackProvider: INotificationProvider;
		discordProvider: INotificationProvider;
		pagerDutyProvider: INotificationProvider;
		matrixProvider: INotificationProvider;
		teamsProvider: INotificationProvider;
		settingsService: ISettingsService;
		logger: ILogger;
		notificationMessageBuilder: INotificationMessageBuilder;
	}) {
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

	private readonly send = async (
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
				return await this.webhookProvider.sendMessage(notification, notificationMessage);
			case "slack":
				return await this.slackProvider.sendMessage(notification, notificationMessage);
			case "matrix":
				return await this.matrixProvider.sendMessage(notification, notificationMessage);
			case "pager_duty":
				return await this.pagerDutyProvider.sendMessage(notification, notificationMessage);
			case "discord":
				return await this.discordProvider.sendMessage(notification, notificationMessage);
			case "email":
				return await this.emailProvider.sendMessage(notification, notificationMessage);
			case "teams":
				return await this.teamsProvider.sendMessage(notification, notificationMessage);
			default:
				this.logger.warn({
					message: `Unknown notification type: ${notification.type}`,
					service: SERVICE_NAME,
					method: "send",
				});
				return false;
		}
	};

	private readonly sendNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
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

	private readonly getEscalationConfig = (monitor: Monitor) => {
		const schedule = Array.from(new Set(monitor.escalationMinutes ?? [])).sort((a, b) => a - b);
		if (schedule.length === 0) {
			return null;
		}

		const notificationIds = (monitor.escalationNotificationIds ?? []).length > 0 ? (monitor.escalationNotificationIds ?? []) : (monitor.notifications ?? []);
		if (notificationIds.length === 0) {
			return null;
		}

		return {
			notificationIds,
			schedule,
			useMonitorEscalationRules: true,
		};
	};

	private readonly getNotificationEscalationSchedule = (notification: Notification): number[] => {
		return Array.from(new Set(notification.escalationMinutes ?? [])).sort((a, b) => a - b);
	};

	private readonly getEscalationCandidates = (notifications: Notification[], useMonitorEscalationRules: boolean): Notification[] => {
		if (useMonitorEscalationRules) {
			return notifications;
		}

		return notifications.filter((notification) => (notification.escalationMinutes ?? []).length > 0);
	};

	private readonly dispatchEscalationNotifications = async (
		escalationCandidates: Notification[],
		escalationScheduleByNotification: (notification: Notification) => number[],
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		activeIncident: { id: string; startTime: string; notificationEscalations?: Record<string, number> },
		sendContext: { clientHost: string; elapsedMinutes: number; decision: MonitorActionDecision },
		nextState: Record<string, number>
	): Promise<boolean> => {
		let sentAnyEscalation = false;

		for (const notification of escalationCandidates) {
			const escalationSchedule = escalationScheduleByNotification(notification);
			if (escalationSchedule.length === 0) {
				continue;
			}

			const result = await this.sendEscalationForNotification(
				notification,
				monitor,
				monitorStatusResponse,
				escalationSchedule,
				activeIncident,
				sendContext
			);
			if (result.nextStageIndex !== null) {
				nextState[notification.id] = result.nextStageIndex;
			}
			if (result.sentAnyEscalation) {
				sentAnyEscalation = true;
			}
		}

		return sentAnyEscalation;
	};

	private readonly sendEscalationForNotification = async (
		notification: Notification,
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		escalationSchedule: number[],
		activeIncident: { id: string; startTime: string; notificationEscalations?: Record<string, number> },
		context: { clientHost: string; elapsedMinutes: number; decision: MonitorActionDecision }
	): Promise<{ sentAnyEscalation: boolean; nextStageIndex: number | null }> => {
		const lastSentStageIndex = activeIncident.notificationEscalations?.[notification.id] ?? -1;
		let highestSentStageIndex = lastSentStageIndex;
		let sentAnyEscalation = false;

		for (let stageIndex = lastSentStageIndex + 1; stageIndex < escalationSchedule.length; stageIndex++) {
			const escalationDelay = escalationSchedule[stageIndex];
			if (context.elapsedMinutes < escalationDelay) {
				break;
			}

			const escalationMessage = this.notificationMessageBuilder.buildEscalationMessage(
				monitor,
				monitorStatusResponse,
				{ id: activeIncident.id, startTime: activeIncident.startTime },
				context.clientHost,
				escalationDelay,
				context.elapsedMinutes
			);
			const sent = await this.send(
				notification,
				monitor,
				monitorStatusResponse,
				{ ...context.decision, notificationReason: "threshold_breach" },
				escalationMessage
			);
			if (!sent) {
				break;
			}

			highestSentStageIndex = stageIndex;
			sentAnyEscalation = true;
		}

		return {
			sentAnyEscalation,
			nextStageIndex: highestSentStageIndex === lastSentStageIndex ? null : highestSentStageIndex,
		};
	};

	private readonly sendEscalations = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident?.status || (monitor.status !== "down" && monitor.status !== "breached")) {
			return false;
		}

		const escalationConfig = this.getEscalationConfig(monitor);
		const notificationIds = escalationConfig?.notificationIds ?? (monitor.notifications ?? []);
		if (notificationIds.length === 0) {
			return false;
		}

		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);
		const escalationCandidates = escalationConfig
			? this.getEscalationCandidates(notifications, escalationConfig.useMonitorEscalationRules)
			: this.getEscalationCandidates(notifications, false);
		if (escalationCandidates.length === 0) {
			return false;
		}

		const clientHost = this.settingsService.getSettings().clientHost || "Host not defined";
		const incidentStart = new Date(activeIncident.startTime).getTime();
		const elapsedMinutes = Math.max(0, Math.floor((Date.now() - incidentStart) / 60000));
		const nextState = activeIncident.notificationEscalations ? { ...activeIncident.notificationEscalations } : {};
		const sendContext = {
			clientHost,
			elapsedMinutes,
			decision,
		};
		const sentAnyEscalation = await this.dispatchEscalationNotifications(
			escalationCandidates,
			(notification) => (escalationConfig ? escalationConfig.schedule : this.getNotificationEscalationSchedule(notification)),
			monitor,
			monitorStatusResponse,
			{ id: activeIncident.id, startTime: activeIncident.startTime, notificationEscalations: nextState },
			sendContext,
			nextState
		);

		if (sentAnyEscalation) {
			await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
				notificationEscalations: nextState,
			});
		}

		return sentAnyEscalation;
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		let initialResult = false;
		if (decision.shouldSendNotification) {
			initialResult = await this.sendNotifications(monitor, monitorStatusResponse, decision);
		}

		const escalationResult = await this.sendEscalations(monitor, monitorStatusResponse, decision);
		return initialResult || escalationResult;
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
