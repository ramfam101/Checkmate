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
	/** Called when a monitor has just transitioned to `down` (from the job queue, after status is persisted). */
	scheduleEscalationOnDownTransition: (
		monitorId: string,
		teamId: string,
		monitorStatusResponse: MonitorStatusResponse,
		downDecision: MonitorActionDecision
	) => Promise<void>;

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}

const SERVICE_NAME = "NotificationsService";

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

function sanitizeNotificationObjectIds(ids: string[] | undefined | null): string[] {
	if (!ids?.length) {
		return [];
	}
	return ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter((id) => OBJECT_ID_HEX.test(id));
}

/** Resolved notification channels for send path (`Monitor.notifications` in DB/API remains `string[]`). */
type MonitorWithResolvedNotifications = Omit<Monitor, "notifications"> & { notifications: Notification[] };

export class NotificationsService implements INotificationsService {
	static SERVICE_NAME = SERVICE_NAME;

	private escalationTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

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
		monitor: Omit<Monitor, "notifications">,
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

	private clearEscalationSchedule = (monitorId: string): void => {
		const existing = this.escalationTimeouts.get(monitorId);
		if (existing !== undefined) {
			clearTimeout(existing);
			this.escalationTimeouts.delete(monitorId);
		}
	};

	private sendNotifications = async (
		monitor: MonitorWithResolvedNotifications,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		notificationMessage?: NotificationMessage
	) => {
		const notifications = monitor.notifications;

		// Build notification message once for all notifications (unless caller supplies one, e.g. escalation)
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const builtMessage =
			notificationMessage ?? this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		const tasks = notifications.map((notification) => this.send(notification, monitor, monitorStatusResponse, decision, builtMessage));

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

	private runEscalation = async (
		monitorId: string,
		teamId: string,
		capturedStatusResponse: MonitorStatusResponse,
		downDecision: MonitorActionDecision
	): Promise<void> => {
		try {
			const current = await this.monitorsRepository.findById(monitorId, teamId);
			if (current.status !== "down") {
				return;
			}
			if (!current.escalationNotifications || current.escalationNotifications.length === 0) {
				return;
			}
			const escalationIds = sanitizeNotificationObjectIds(current.escalationNotifications);
			if (escalationIds.length === 0) {
				return;
			}
			const allNotifications = await this.notificationsRepository.findByTeamId(teamId);
			const escalationNotificationsFull = allNotifications.filter((n) => escalationIds.includes(n.id));
			console.log("Escalation IDs:", escalationIds);
			console.log("Resolved escalation notifications:", escalationNotificationsFull);
			console.log("Escalation triggered:", current.name);
			const monitorForEscalationSend: MonitorWithResolvedNotifications = {
				...current,
				notifications: escalationNotificationsFull,
			};
			try {
				const settings = this.settingsService.getSettings();
				const clientHost = settings.clientHost || "Host not defined";
				const originalMessage = this.notificationMessageBuilder.buildMessage(
					monitorForEscalationSend,
					capturedStatusResponse,
					downDecision,
					clientHost
				);
				const delayMinutes = Math.max(0, Math.floor(Number(current.escalationDelay) || 0));
				const escalationTitle = `Escalation: Monitor ${current.name} still down`;
				const escalationSummary = `Monitor "${current.name}" is still down after ${delayMinutes} minutes.`;
				const escalationMessage: NotificationMessage = {
					...originalMessage,
					metadata: {
						...originalMessage.metadata,
						emailSubjectOverride: escalationTitle,
					},
					content: {
						...originalMessage.content,
						title: escalationTitle,
						summary: escalationSummary,
					},
				};
				await this.sendNotifications(monitorForEscalationSend, capturedStatusResponse, downDecision, escalationMessage);
			} catch (error: unknown) {
				console.error("Escalation email error:", error);
				this.logger.error({
					message: `Escalation send failed for monitor ${monitorId}: ${error instanceof Error ? error.message : "Unknown error"}`,
					service: SERVICE_NAME,
					method: "runEscalation",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		} catch (error: unknown) {
			console.error("Escalation email error:", error);
			this.logger.error({
				message: `Escalation run failed for monitor ${monitorId}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "runEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	scheduleEscalationOnDownTransition = async (
		monitorId: string,
		teamId: string,
		monitorStatusResponse: MonitorStatusResponse,
		downDecision: MonitorActionDecision
	): Promise<void> => {
		try {
			const monitor = await this.monitorsRepository.findById(monitorId, teamId);
			if (monitor.status !== "down") {
				return;
			}
			const delayMinutes = Math.max(0, Math.floor(Number(monitor.escalationDelay) || 0));
			if (!delayMinutes || !monitor.escalationNotifications || monitor.escalationNotifications.length === 0) {
				return;
			}
			if (sanitizeNotificationObjectIds(monitor.escalationNotifications).length === 0) {
				return;
			}

			console.log("Escalation scheduled:", monitor.name);
			this.clearEscalationSchedule(monitor.id);
			const ms = delayMinutes * 60 * 1000;
			const timeout = setTimeout(() => {
				this.escalationTimeouts.delete(monitor.id);
				void this.runEscalation(monitor.id, teamId, monitorStatusResponse, downDecision);
			}, ms);
			this.escalationTimeouts.set(monitor.id, timeout);
		} catch (error: unknown) {
			this.logger.error({
				message: `Failed to schedule escalation for monitor ${monitorId}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "scheduleEscalationOnDownTransition",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	handleNotifications = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		if (!decision.shouldSendNotification) {
			return false;
		}

		if (monitor.status !== "down") {
			this.clearEscalationSchedule(monitor.id);
		}

		const resolvedNotifications = await this.notificationsRepository.findNotificationsByIds(monitor.notifications ?? []);
		const monitorForSend: MonitorWithResolvedNotifications = { ...monitor, notifications: resolvedNotifications };
		return await this.sendNotifications(monitorForSend, monitorStatusResponse, decision);
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
