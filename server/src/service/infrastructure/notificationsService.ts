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
		return await this.sendNotificationsByIds(notificationIds, monitor, monitorStatusResponse, decision);
	};

	private sendNotificationsByIds = async (
		notificationIds: string[],
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		notificationMessageOverride?: NotificationMessage
	) => {
		if (notificationIds.length === 0) {
			return true;
		}

		const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

		// Build notification message once for all notifications
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage =
			notificationMessageOverride ?? this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

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

	private buildEscalationMessage(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		clientHost: string,
		delayMinutes: number,
		intervalCount: number,
		elapsedMinutes: number
	): NotificationMessage {
		const escalationMonitor = {
			...monitor,
			status: "down" as const,
		};
		const escalationDecision: MonitorActionDecision = {
			...decision,
			notificationReason: "escalation",
		};
		const baseMessage = this.notificationMessageBuilder.buildMessage(escalationMonitor, monitorStatusResponse, escalationDecision, clientHost);
		const details = [...(baseMessage.content.details ?? [])];
		details.push(
			`Escalation interval reached: ${delayMinutes} minute(s) x${intervalCount}. Incident active for ${elapsedMinutes.toFixed(1)} minute(s).`
		);

		return {
			...baseMessage,
			content: {
				...baseMessage.content,
				details,
			},
			metadata: {
				...baseMessage.metadata,
				notificationReason: "escalation",
			},
		};
	}

	private normalizeDelay = (delayMinutes: number): string => delayMinutes.toFixed(3);

	private toEscalationKey = (delayMinutes: number, intervalCount: number): string => `${this.normalizeDelay(delayMinutes)}:${intervalCount}`;

	private getDueEscalationCycles = (
		monitor: Monitor,
		activeIncident: Incident
	): Array<{ delayMinutes: number; intervalCount: number; elapsedMinutes: number }> => {
		const policy = [...(monitor.escalationPolicy ?? [])]
			.filter((step) => step.delayMinutes >= 0.1 && (step.notifications?.length ?? 0) > 0)
			.sort((a, b) => a.delayMinutes - b.delayMinutes);

		if (policy.length === 0) {
			return [];
		}

		const startMs = new Date(activeIncident.startTime).getTime();
		if (!Number.isFinite(startMs)) {
			return [];
		}

		const elapsedMinutes = (Date.now() - startMs) / 60000;
		if (elapsedMinutes < 0.1) {
			return [];
		}

		const alreadySent = new Set(activeIncident.sentEscalationKeys ?? []);

		// Backward compatibility: map previous one-shot sent delays to first interval keys.
		for (const sentDelay of activeIncident.sentEscalationDelays ?? []) {
			alreadySent.add(this.toEscalationKey(sentDelay, 1));
		}

		const dueCycles: Array<{ delayMinutes: number; intervalCount: number; elapsedMinutes: number }> = [];
		for (const step of policy) {
			const maxIntervalCount = Math.floor(elapsedMinutes / step.delayMinutes);
			if (maxIntervalCount < 1) {
				continue;
			}

			for (let intervalCount = 1; intervalCount <= maxIntervalCount; intervalCount += 1) {
				const escalationKey = this.toEscalationKey(step.delayMinutes, intervalCount);
				if (alreadySent.has(escalationKey)) {
					continue;
				}
				dueCycles.push({
					delayMinutes: step.delayMinutes,
					intervalCount,
					elapsedMinutes,
				});
			}
		}

		return dueCycles;
	};

	private sendEscalationNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return false;
		}

		const dueCycles = this.getDueEscalationCycles(monitor, activeIncident);
		if (dueCycles.length === 0) {
			return false;
		}

		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const sentKeys = new Set(activeIncident.sentEscalationKeys ?? []);
		let allSucceeded = true;

		for (const dueCycle of dueCycles) {
			const step = (monitor.escalationPolicy ?? []).find(
				(policyStep) => this.normalizeDelay(policyStep.delayMinutes) === this.normalizeDelay(dueCycle.delayMinutes)
			);
			if (!step || step.notifications.length === 0) {
				continue;
			}

			const escalationMessage = this.buildEscalationMessage(
				monitor,
				monitorStatusResponse,
				decision,
				clientHost,
				dueCycle.delayMinutes,
				dueCycle.intervalCount,
				dueCycle.elapsedMinutes
			);
			const success = await this.sendNotificationsByIds(step.notifications, monitor, monitorStatusResponse, decision, escalationMessage);
			if (!success) {
				allSucceeded = false;
				continue;
			}

			sentKeys.add(this.toEscalationKey(dueCycle.delayMinutes, dueCycle.intervalCount));
		}

		await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
			sentEscalationKeys: Array.from(sentKeys).sort(),
		});

		return allSucceeded;
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		if (decision.notificationReason === "status_change") {
			await this.sendEscalationNotifications(monitor, monitorStatusResponse, decision);
			return await this.sendNotifications(monitor, monitorStatusResponse, decision);
		}

		if (decision.notificationReason === "escalation") {
			return await this.sendEscalationNotifications(monitor, monitorStatusResponse, decision);
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
