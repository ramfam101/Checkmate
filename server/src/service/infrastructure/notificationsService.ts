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
		// Return true if all notifications succeeded
		return succeeded === notifications.length;
	};

	private buildEscalationNotificationMessage = (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): NotificationMessage => {
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const message = this.notificationMessageBuilder.buildMessage(
			monitor,
			monitorStatusResponse,
			{
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: false,
				incidentReason: null,
				notificationReason: "status_change",
			},
			clientHost
		);
		// Override content to make it clearly an escalation
		message.content.title = `Escalation Alert: Monitor ${monitor.name} is still down`;
		message.content.summary = `Monitor "${monitor.name}" has been down for an extended period and requires immediate attention.`;
		return message;
	};

	private sendEscalationNotification = async (
		rule: { delayMinutes: number; notificationId?: string; email?: string },
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse
	): Promise<boolean> => {
		this.logger.warn({
			message: `[ESCALATION DEBUG] attempting to send escalation, notificationId: ${rule.notificationId}, email: ${rule.email}`,
			service: SERVICE_NAME,
			method: "sendEscalationNotification",
		});
		const notificationMessage = this.buildEscalationNotificationMessage(monitor, monitorStatusResponse);

		if (rule.notificationId) {
			// Use existing notification channel
			const notifications = await this.notificationsRepository.findNotificationsByIds([rule.notificationId]);
			if (!notifications.length) {
				this.logger.warn({
					message: `Escalation notification ${rule.notificationId} not found`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
				});
				return false;
			}

			const notification = notifications[0];
			return await this.send(
				notification,
				monitor,
				monitorStatusResponse,
				{
					shouldCreateIncident: false,
					shouldResolveIncident: false,
					shouldSendNotification: false,
					incidentReason: null,
					notificationReason: "status_change",
				},
				notificationMessage
			);
		} else if (rule.email) {
			// Send directly to email address
			const tempNotification: Notification = {
				id: `escalation-${rule.email}`,
				teamId: monitor.teamId,
				userId: monitor.userId,
				notificationName: "Escalation Alert",
				type: "email",
				address: rule.email,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			return await this.send(
				tempNotification,
				monitor,
				monitorStatusResponse,
				{
					shouldCreateIncident: false,
					shouldResolveIncident: false,
					shouldSendNotification: false,
					incidentReason: null,
					notificationReason: "status_change",
				},
				notificationMessage
			);
		} else {
			this.logger.warn({
				message: "Escalation rule has neither notificationId nor email",
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
			});
			return false;
		}
	};

	handleEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse) => {
		this.logger.warn({
			message: `[ESCALATION DEBUG] called for monitor ${monitor.id}, status: ${monitor.status}`,
			service: SERVICE_NAME,
			method: "handleEscalationNotifications",
		});

		if (monitor.status !== "down") {
			this.logger.warn({
				message: `[ESCALATION DEBUG] returning early - status is not down`,
				service: SERVICE_NAME,
				method: "handleEscalationNotifications",
			});
			return false;
		}

		if (!monitor.escalationRules?.length) {
			this.logger.warn({
				message: `[ESCALATION DEBUG] returning early - no escalation rules`,
				service: SERVICE_NAME,
				method: "handleEscalationNotifications",
			});
			return false;
		}

		// Fetch fresh monitor from DB to get latest downtimeStartedAt
		const freshMonitor = await this.monitorsRepository.findById(monitor.id, monitor.teamId);

		const now = Date.now();
		const downtimeStartedAt = freshMonitor.downtimeStartedAt ?? now;
		const sentNotifications = new Set(freshMonitor.escalationNotificationsSent ?? []);

		this.logger.warn({
			message: `[ESCALATION DEBUG] fresh downtimeStartedAt: ${downtimeStartedAt}`,
			service: SERVICE_NAME,
			method: "handleEscalationNotifications",
		});

		// Save downtimeStartedAt if not set
		if (!freshMonitor.downtimeStartedAt) {
			await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
				downtimeStartedAt,
				escalationNotificationsSent: [],
			});
		}

		this.logger.warn({
			message: `[ESCALATION DEBUG] sentNotifications: ${JSON.stringify(Array.from(sentNotifications))}, now: ${now}, downtimeStartedAt: ${downtimeStartedAt}, diff: ${now - downtimeStartedAt}, threshold: ${freshMonitor.escalationRules[0]?.delayMinutes * 60_000}`,
			service: SERVICE_NAME,
			method: "handleEscalationNotifications",
		});

		const dueRules = freshMonitor.escalationRules.filter((rule) => {
			const identifier = rule.notificationId || rule.email;
			if (!identifier) return false;
			if (sentNotifications.has(identifier)) return false;
			return now - downtimeStartedAt >= rule.delayMinutes * 60_000;
		});

		this.logger.warn({
			message: `[ESCALATION DEBUG] due rules: ${dueRules.length}, time elapsed: ${now - downtimeStartedAt}ms`,
			service: SERVICE_NAME,
			method: "handleEscalationNotifications",
		});

		if (!dueRules.length) return false;

		const results = await Promise.all(
			dueRules.map(async (rule) => {
				const success = await this.sendEscalationNotification(rule, monitor, monitorStatusResponse);
				if (success) {
					const identifier = rule.notificationId || rule.email;
					if (identifier) sentNotifications.add(identifier);
				}
				return success;
			})
		);

		const successfulSends = results.filter(Boolean).length;
		if (successfulSends > 0) {
			await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
				downtimeStartedAt,
				escalationNotificationsSent: Array.from(sentNotifications),
			});
		}

		return successfulSends === dueRules.length;
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
}
