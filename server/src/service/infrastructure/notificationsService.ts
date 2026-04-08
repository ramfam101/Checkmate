import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository, IIncidentsRepository } from "@/repositories/index.js";
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
		decision: MonitorActionDecision
	) => {
		const notificationIds = monitor.notifications ?? [];
		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(
			monitor,
			monitorStatusResponse,
			decision,
			clientHost
		);

		const tasks = notifications.map((notification) =>
			this.send(notification, monitor, monitorStatusResponse, decision, notificationMessage)
		);

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

		return succeeded === notifications.length;
	};

	handleNotifications = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	) => {
		let immediateResult = false;

		if (decision.shouldSendNotification) {
			immediateResult = await this.sendNotifications(
				monitor,
				monitorStatusResponse,
				decision
			);
		}

		await this.handleEscalationNotifications(
			monitor,
			monitorStatusResponse,
			decision
		);

		return immediateResult;
	};

	private handleEscalationNotifications = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	) => {
		if (!monitor.escalationRules || monitor.escalationRules.length === 0) {
			return;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(
			monitor.id,
			monitor.teamId
		);

		if (!activeIncident || !activeIncident.status) {
	return;
}

    const now = new Date();
    const incidentStart = new Date(activeIncident.startTime);
    const minutesElapsed = (now.getTime() - incidentStart.getTime()) / (1000 * 60);
    const sentRuleIds = activeIncident.sentEscalationRules?.map((r) => r.ruleId) || [];

    this.logger.warn({
	    message: `Escalation check for monitor ${monitor.id}: activeIncident=${!!activeIncident}, minutesElapsed=${minutesElapsed}, rules=${JSON.stringify(monitor.escalationRules)}, sentRuleIds=${JSON.stringify(sentRuleIds)}`,
	    service: SERVICE_NAME,
	    method: "handleEscalationNotifications",
});

    const settings = this.settingsService.getSettings();
    const clientHost = settings.clientHost || "Host not defined";
    const notificationMessage = this.notificationMessageBuilder.buildMessage(
	    monitor,
	    monitorStatusResponse,
	    decision,
	    clientHost
);

		for (const rule of monitor.escalationRules) {
			const ruleId = `${rule.delayMinutes}-${rule.channelId}`;

			if (sentRuleIds.includes(ruleId)) {
				continue;
			}

			if (minutesElapsed >= rule.delayMinutes) {
				try {
					const escalationNotification = await this.notificationsRepository.findById(
						rule.channelId,
						monitor.teamId
					);

					if (!escalationNotification) {
						continue;
					}

					const sent = await this.send(
						escalationNotification,
						monitor,
						monitorStatusResponse,
						decision,
						notificationMessage
					);

					if (sent) {
						const sentEscalationRules = activeIncident.sentEscalationRules || [];
						sentEscalationRules.push({
							ruleId,
							sentAt: now,
						});

						await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
							sentEscalationRules,
						});
					}
				} catch (error: unknown) {
					this.logger.error({
						message: `Error sending escalation notification for rule ${ruleId}: ${
							error instanceof Error ? error.message : "Unknown error"
						}`,
						service: SERVICE_NAME,
						method: "handleEscalationNotifications",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
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

	createNotification = async (
		notificationData: Partial<Notification>,
		userId: string,
		teamId: string
	): Promise<Notification> => {
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

	updateById = async (
		id: string,
		teamId: string,
		updateData: Partial<Notification>
	): Promise<Notification> => {
		return await this.notificationsRepository.updateById(id, teamId, updateData);
	};

	deleteById = async (id: string, teamId: string): Promise<Notification> => {
		const deleted = await this.notificationsRepository.deleteById(id, teamId);
		await this.monitorsRepository.removeNotificationFromMonitors(id);
		return deleted;
	};
}