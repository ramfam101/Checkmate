import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository, INotificationHistoryRepository, IIncidentsRepository } from "@/repositories/index.js";
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
	handleEscalationNotifications: (incidentId: string) => Promise<boolean>; // Check and send escalation notifications for an incident
	sendEscalationNotification: (notification: Notification, incidentId: string, escalationId: string) => Promise<boolean>; // Send a specific escalation

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}

const SERVICE_NAME = "NotificationsService";

export class NotificationsService implements INotificationsService {
	static SERVICE_NAME = SERVICE_NAME;

	private notificationsRepository: INotificationsRepository;
	private notificationHistoryRepository: INotificationHistoryRepository;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private webhookProvider: INotificationProvider;
	private emailProvider: INotificationProvider;
	private slackProvider: INotificationProvider;
	private discordProvider: INotificationProvider;
	private pagerDutyProvider: INotificationProvider;
	private matrixProvider: INotificationProvider;
	private teamsProvider: INotificationProvider;
	private telegramProvider: INotificationProvider;
	private logger: ILogger;
	private settingsService: ISettingsService;
	private notificationMessageBuilder: INotificationMessageBuilder;

	constructor(
		notificationsRepository: INotificationsRepository,
		notificationHistoryRepository: INotificationHistoryRepository,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		webhookProvider: INotificationProvider,
		emailProvider: INotificationProvider,
		slackProvider: INotificationProvider,
		discordProvider: INotificationProvider,
		pagerDutyProvider: INotificationProvider,
		matrixProvider: INotificationProvider,
		teamsProvider: INotificationProvider,
		telegramProvider: INotificationProvider,
		settingsService: ISettingsService,
		logger: ILogger,
		notificationMessageBuilder: INotificationMessageBuilder
	) {
		this.notificationsRepository = notificationsRepository;
		this.notificationHistoryRepository = notificationHistoryRepository;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.webhookProvider = webhookProvider;
		this.emailProvider = emailProvider;
		this.slackProvider = slackProvider;
		this.discordProvider = discordProvider;
		this.pagerDutyProvider = pagerDutyProvider;
		this.matrixProvider = matrixProvider;
		this.teamsProvider = teamsProvider;
		this.telegramProvider = telegramProvider;
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
			case "telegram":
				return await this.telegramProvider.sendMessage!(notification, notificationMessage);
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

	handleEscalationNotifications = async (incidentId: string): Promise<boolean> => {
		try {
			// For escalation checks, we need to find the incident first to get its teamId
			// Since findActiveIncidents gives us incidents across all teams, we need to search
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();
			const incident = activeIncidents.find(i => i.id === incidentId);
			
			if (!incident || incident.endTime) {
				// Incident doesn't exist or is resolved
				return false;
			}

			// Get the monitor to find associated notifications
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor) {
				return false;
			}

			const notificationIds = monitor.notifications ?? [];
			if (notificationIds.length === 0) {
				return false;
			}

			// Get all notifications for this monitor
			const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

			// Filter notifications that have escalation enabled
			const escalatedNotifications = notifications.filter(n => n.escalationEnabled && n.escalations?.length);

			if (escalatedNotifications.length === 0) {
				return false;
			}

			// Calculate incident duration in minutes
			const incidentStart = new Date(incident.startTime);
			const now = new Date();
			const incidentDurationMinutes = Math.floor((now.getTime() - incidentStart.getTime()) / (1000 * 60));

			let escalationSent = false;

			// Check each notification for escalations that should be triggered
			for (const notification of escalatedNotifications) {
				if (!notification.escalations) continue;

				for (const escalation of notification.escalations) {
					if (!escalation.enabled) continue;

					// Check if this escalation should be triggered
					if (incidentDurationMinutes >= escalation.delayMinutes) {
						// Check if this escalation has already been sent
						const existingHistory = await this.notificationHistoryRepository.findByIncidentAndEscalation(incidentId, escalation.id);
						if (!existingHistory) {
							// Send the escalation
							const success = await this.sendEscalationNotification(notification, incidentId, escalation.id);
							if (success) {
								escalationSent = true;
							}
						}
					}
				}
			}

			return escalationSent;
		} catch (error) {
			this.logger.error({
				message: `Failed to handle escalation notifications for incident ${incidentId}`,
				service: SERVICE_NAME,
				method: "handleEscalationNotifications",
			});
			return false;
		}
	};

	sendEscalationNotification = async (notification: Notification, incidentId: string, escalationId: string): Promise<boolean> => {
		try {
			// For escalation, we need to find the incident first to get its teamId
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();
			const incident = activeIncidents.find(i => i.id === incidentId);
			
			if (!incident) {
				return false;
			}

			// Get incident and monitor details
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);

			if (!incident || !monitor) {
				return false;
			}

			// Find the escalation details
			const escalation = notification.escalations?.find(e => e.id === escalationId);
			if (!escalation) {
				return false;
			}

			// Load the escalation target channel (escalation.id is a notification document ID)
			const [escalationNotification] = await this.notificationsRepository.findNotificationsByIds([escalation.id]);
			if (!escalationNotification) {
				this.logger.warn({
					message: `Escalation target notification ${escalation.id} not found`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
				});
				await this.notificationHistoryRepository.create({
					incidentId,
					notificationId: notification.id,
					escalationId,
					sentAt: new Date(),
					status: "failed",
					errorMessage: `Escalation channel ${escalation.id} not found`,
				});
				return false;
			}

			// Build escalation message
			const settings = this.settingsService.getSettings();
			const clientHost = settings.clientHost || "Host not defined";

			// Calculate escalation details
			const escalationLevel = (notification.escalations?.filter(e => e.enabled && e.delayMinutes <= escalation.delayMinutes).length || 1);

			const notificationMessage = this.notificationMessageBuilder.buildEscalationMessage(
				monitor,
				incident,
				escalation,
				escalationLevel,
				clientHost
			);

			// Send via the escalation target channel
			const success = await this.sendEscalation(escalationNotification, monitor, incident, escalation, notificationMessage);

			// Record the notification history
			await this.notificationHistoryRepository.create({
				incidentId,
				notificationId: notification.id,
				escalationId,
				sentAt: new Date(),
				status: success ? "sent" : "failed",
				errorMessage: success ? undefined : "Failed to send escalation notification",
			});

			return success;
		} catch (error) {
			this.logger.error({
				message: `Failed to send escalation notification`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
			});
			return false;
		}
	};

	private sendEscalation = async (
		notification: Notification,
		monitor: Monitor,
		incident: any,
		escalation: any,
		notificationMessage: NotificationMessage | undefined
	): Promise<boolean> => {
		if (!notificationMessage) {
			this.logger.warn({
				message: "Escalation notification message not provided",
				service: SERVICE_NAME,
				method: "sendEscalation",
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
					message: `Unknown notification type for escalation: ${notification.type}`,
					service: SERVICE_NAME,
					method: "sendEscalation",
				});
				return false;
		}
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
			case "telegram":
				return await this.telegramProvider.sendTestAlert(notification);
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
