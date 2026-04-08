import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository, IEscalationsRepository, IIncidentsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import { Types } from "mongoose";

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision, incidentId?: string) => Promise<boolean>;
	scheduleEscalations: (incidentId: string, monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<void>;
	sendEscalation: (escalationId: string) => Promise<boolean>;

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}

const SERVICE_NAME = "NotificationsService";

export class NotificationsService implements INotificationsService {
	static SERVICE_NAME = SERVICE_NAME;

	private notificationsRepository: INotificationsRepository;
	private monitorsRepository: IMonitorsRepository;
	private incidentsRepository: IIncidentsRepository;
	private escalationsRepository: IEscalationsRepository;
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
		escalationsRepository: IEscalationsRepository,
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
		this.escalationsRepository = escalationsRepository;
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

	private sendEscalationNotification = async (
		notification: Notification,
		monitor: Monitor,
		incident: any, // Using any for now since I need to check the Incident type
		escalation: any, // Using any for now since I need to check the Escalation type
		notificationMessage: NotificationMessage
	): Promise<boolean> => {
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
					method: "sendEscalationNotification",
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

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision, incidentId?: string) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		// For incident creation with escalations enabled, schedule escalations instead of sending immediately
		if (decision.incidentReason === "status_down" && incidentId) {
			await this.scheduleEscalations(incidentId, monitor, monitorStatusResponse, decision);
			return true; // Consider scheduling successful
		}

		// For recovery or other cases, send notifications immediately
		return await this.sendNotifications(monitor, monitorStatusResponse, decision);
	};

	scheduleEscalations = async (incidentId: string, monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const notificationIds = monitor.notifications ?? [];
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		const monitorEscalationIds = monitor.escalationNotifications ?? [];
		const monitorEscalationRate = monitor.escalationRate ?? 0;

		// Send the immediate notification for the current incident state
		await this.sendNotifications(monitor, monitorStatusResponse, decision);

		// Schedule monitor-level escalations when configured
		if (monitorEscalationRate > 0 && monitorEscalationIds.length > 0) {
			const escalationNotifications = await this.notificationsRepository.findNotificationsByIds(monitorEscalationIds);

			for (const notification of escalationNotifications) {
				try {
					await this.escalationsRepository.create({
						incidentId: new Types.ObjectId(incidentId),
						notificationId: new Types.ObjectId(notification.id),
						teamId: new Types.ObjectId(monitor.teamId),
						delayMinutes: monitorEscalationRate,
					});
				} catch (error) {
					this.logger.error({
						message: `Failed to schedule monitor escalation for notification ${notification.id}`,
						service: SERVICE_NAME,
						method: "scheduleEscalations",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		}

		// Preserve backwards compatibility with notification-level escalations
		const notificationsWithEscalations = notifications.filter(n => n.escalationsEnabled && n.escalations && n.escalations.length > 0);
		for (const notification of notificationsWithEscalations) {
			for (const escalation of notification.escalations ?? []) {
				try {
					await this.escalationsRepository.create({
						incidentId: new Types.ObjectId(incidentId),
						notificationId: new Types.ObjectId(notification.id),
						teamId: new Types.ObjectId(monitor.teamId),
						delayMinutes: escalation.delayMinutes,
						message: escalation.message,
					});
				} catch (error) {
					this.logger.error({
						message: `Failed to schedule notification escalation for notification ${notification.id}`,
						service: SERVICE_NAME,
						method: "scheduleEscalations",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		}
	};

	sendEscalation = async (escalationId: string) => {
		try {
			// Get escalation details
			const escalation = await this.escalationsRepository.findById(escalationId); // Need to add this method
			if (!escalation) {
				this.logger.warn({
					message: `Escalation ${escalationId} not found`,
					service: SERVICE_NAME,
					method: "sendEscalation",
				});
				return false;
			}

			// Get notification
			const notification = await this.notificationsRepository.findById(escalation.notificationId.toString(), escalation.teamId.toString());
			if (!notification) {
				this.logger.warn({
					message: `Notification ${escalation.notificationId} not found`,
					service: SERVICE_NAME,
					method: "sendEscalation",
				});
				return false;
			}

			// Get monitor and incident details for message
			const incident = await this.incidentsRepository.findById(escalation.incidentId.toString(), escalation.teamId.toString());
			const monitor = await this.monitorsRepository.findById(incident.monitorId.toString(), escalation.teamId.toString());

			// Build escalation message
			const settings = this.settingsService.getSettings();
			const clientHost = settings.clientHost || "Host not defined";
			const notificationMessage = this.notificationMessageBuilder.buildEscalationMessage(
				monitor,
				incident,
				escalation,
				clientHost
			);

			// Send the notification
			const success = await this.sendEscalationNotification(notification, monitor, incident, escalation, notificationMessage);

			if (success) {
				// Mark as sent
				await this.escalationsRepository.markAsSent(escalationId, escalation.teamId.toString());
			}

			return success;
		} catch (error) {
			this.logger.error({
				message: `Error sending escalation ${escalationId}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEscalation",
				stack: error instanceof Error ? error.stack : undefined,
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
			default:
				throw new Error(`Unsupported notification type: ${notification.type}`);
		}
	};

	testAllNotifications = async (notificationIds: string[]) => {
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);
		const tasks = notifications.map(async (notification) => {
			try {
				await this.sendTestNotification(notification);
				return true;
			} catch (error) {
				this.logger.warn({
					message: `Test notification failed for ${notification.type} notification ${notification.id}`,
					service: SERVICE_NAME,
					method: "testAllNotifications",
					stack: error instanceof Error ? error.stack : undefined,
				});
				return false;
			}
		});
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
