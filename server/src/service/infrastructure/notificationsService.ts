import type { Incident, Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
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
	handleEscalationNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse) => Promise<boolean>;

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

	private send = async (notification: Notification, notificationMessage: NotificationMessage | undefined): Promise<boolean> => {
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

	private sanitizeEscalationAfterMinutes = (minutes?: number): number | null => {
		if (!Number.isInteger(minutes) || (minutes ?? 0) <= 0 || (minutes ?? 0) > 10080) {
			return null;
		}

		return Number(minutes);
	};

	private buildEscalationKey = (notificationId: string, escalationMinute: number): string => {
		return `${notificationId}:${escalationMinute}`;
	};

	private getIncidentDurationMinutes = (incident: Incident): number => {
		const startMs = new Date(incident.startTime).getTime();
		if (!Number.isFinite(startMs)) {
			return 0;
		}

		const durationMs = Math.max(0, Date.now() - startMs);
		return Math.floor(durationMs / 60000);
	};

	private sendNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const notificationIds = monitor.notifications ?? [];
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		// Build notification message once for all notifications
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		const tasks = notifications.map((notification) => this.send(notification, notificationMessage));

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

	handleEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse) => {
		if (monitor.status !== "down" && monitor.status !== "breached") {
			return false;
		}

		const escalationAfterMinutes = this.sanitizeEscalationAfterMinutes(monitor.escalationAfterMinutes);
		if (!escalationAfterMinutes) {
			return false;
		}

		const escalationNotificationIds = monitor.escalationNotifications ?? [];
		if (escalationNotificationIds.length === 0) {
			return false;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return false;
		}

		const incidentDurationMinutes = this.getIncidentDurationMinutes(activeIncident);
		if (incidentDurationMinutes <= 0) {
			return false;
		}

		if (incidentDurationMinutes < escalationAfterMinutes) {
			return false;
		}

		const notifications = await this.notificationsRepository.findNotificationsByIds(escalationNotificationIds);
		if (notifications.length === 0) {
			return false;
		}

		const sentEscalationKeys = new Set(activeIncident.escalationSentKeys ?? []);
		let shouldPersistEscalationState = false;
		let sentAnyEscalation = false;

		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";

		for (const notification of notifications) {
			const escalationKey = this.buildEscalationKey(notification.id, escalationAfterMinutes);
			if (sentEscalationKeys.has(escalationKey)) {
				continue;
			}

			const escalationDecision: MonitorActionDecision = {
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "incident_escalation",
				escalationDurationMinutes: incidentDurationMinutes,
				escalationThresholdMinutes: escalationAfterMinutes,
			};

			const notificationMessage = this.notificationMessageBuilder.buildMessage(
				monitor,
				monitorStatusResponse,
				escalationDecision,
				clientHost
			);

			const sent = await this.send(notification, notificationMessage);
			if (sent) {
				sentEscalationKeys.add(escalationKey);
				shouldPersistEscalationState = true;
				sentAnyEscalation = true;
			}
		}

		if (shouldPersistEscalationState) {
			await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
				escalationSentKeys: [...sentEscalationKeys],
			});
		}

		return sentAnyEscalation;
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
