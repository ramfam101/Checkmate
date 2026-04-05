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
	private monitorsRepository: IMonitorsRepository;
	private incidentsRepository: IIncidentsRepository;
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
		incidentsRepository: IIncidentsRepository,
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

	private formatDuration = (minutes: number): string => {
		if (minutes < 60) {
			return `${minutes} minute${minutes === 1 ? "" : "s"}`;
		}
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		if (remainingMinutes === 0) {
			return `${hours} hour${hours === 1 ? "" : "s"}`;
		}
		return `${hours}h ${remainingMinutes}m`;
	};

	private wasEscalationAlreadySent = (incident: Incident, durationMinutes: number, email: string): boolean => {
		const sentEscalations = incident.sentEscalations ?? [];
		const normalizedEmail = email.toLowerCase().trim();
		return sentEscalations.some((entry) => entry.durationMinutes === durationMinutes && entry.email.toLowerCase().trim() === normalizedEmail);
	};

	private buildEscalationNotificationMessage = (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		durationMinutes: number,
		downMinutes: number
	): NotificationMessage => {
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const durationLabel = this.formatDuration(durationMinutes);
		const currentDowntimeLabel = this.formatDuration(Math.max(1, downMinutes));

		return {
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
				title: `Escalation: ${monitor.name} is still down`,
				summary: `Monitor "${monitor.name}" has been down for ${currentDowntimeLabel}. Escalation threshold reached: ${durationLabel}.`,
				details: [
					`Monitor: ${monitor.name}`,
					`URL: ${monitor.url}`,
					`Downtime so far: ${currentDowntimeLabel}`,
					`Escalation threshold: ${durationLabel}`,
					`Latest status code: ${monitorStatusResponse.code}`,
				],
				timestamp: new Date(),
			},
			clientHost,
			metadata: {
				teamId: monitor.teamId,
				notificationReason: "escalation",
			},
		};
	};

	private sendEscalationEmail = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		durationMinutes: number,
		downMinutes: number,
		email: string
	): Promise<boolean> => {
		const message = this.buildEscalationNotificationMessage(monitor, monitorStatusResponse, durationMinutes, downMinutes);
		const syntheticEmailNotification: Notification = {
			id: `escalation-${monitor.id}-${durationMinutes}`,
			userId: monitor.userId,
			teamId: monitor.teamId,
			type: "email",
			notificationName: `Escalation ${durationMinutes}m`,
			address: email,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		return this.emailProvider.sendMessage(syntheticEmailNotification, message);
	};

	handleEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): Promise<boolean> => {
		if (monitor.status !== "down") {
			return false;
		}

		const escalationRules = monitor.escalationRules ?? [];
		if (escalationRules.length === 0) {
			return false;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return false;
		}

		const incidentStart = new Date(activeIncident.startTime).getTime();
		if (Number.isNaN(incidentStart)) {
			return false;
		}

		const now = Date.now();
		const downMinutes = Math.floor((now - incidentStart) / 60000);
		if (downMinutes <= 0) {
			return false;
		}

		const sortedRules = [...escalationRules].sort((a, b) => a.durationMinutes - b.durationMinutes);
		const pendingRules = sortedRules.filter(
			(rule) => downMinutes >= rule.durationMinutes && !this.wasEscalationAlreadySent(activeIncident, rule.durationMinutes, rule.email)
		);

		if (pendingRules.length === 0) {
			return false;
		}

		let sentAny = false;
		const sentEscalations = [...(activeIncident.sentEscalations ?? [])];

		for (const rule of pendingRules) {
			const sent = await this.sendEscalationEmail(monitor, monitorStatusResponse, rule.durationMinutes, downMinutes, rule.email);
			if (!sent) {
				this.logger.warn({
					message: `Failed to send escalation email for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleEscalationNotifications",
					details: { durationMinutes: rule.durationMinutes, email: rule.email },
				});
				continue;
			}

			sentAny = true;
			sentEscalations.push({
				durationMinutes: rule.durationMinutes,
				email: rule.email.toLowerCase().trim(),
				sentAt: new Date().toISOString(),
			});
		}

		if (sentAny) {
			await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
				sentEscalations,
			});
		}

		return sentAny;
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
