import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import { IncidentModel } from "@/db/models/Incident.js";
import type { Incident } from "@/types/incident.js";

export interface INotificationsService {
	createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
	findById: (id: string, teamId: string) => Promise<Notification>;
	findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
	updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
	deleteById: (id: string, teamId: string) => Promise<Notification>;
	handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;

	sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
	testAllNotifications: (notificationIds: string[]) => Promise<boolean>;

	// Escalation methods
	processEscalations: () => Promise<void>;
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

	/**
	 * Process escalation notifications for monitors that have been down longer than their configured delay
	 */
	processEscalations = async (): Promise<void> => {
		try {
			console.log("[ESCALATION] Starting escalation check process");

			// Find all monitors with escalation enabled
			const monitors = await this.monitorsRepository.findMonitorsWithEscalationEnabled();
			console.log(`[ESCALATION] Found ${monitors.length} monitors with escalation enabled`);

			for (const monitor of monitors) {
				console.log(`[ESCALATION] Checking monitor: ${monitor.name} (${monitor.id})`);
				await this.checkAndSendEscalation(monitor);
			}

			console.log("[ESCALATION] Escalation check process completed");
		} catch (error) {
			console.error("[ESCALATION] Error in processEscalations:", error);
			this.logger.error({
				message: "Error processing escalations",
				service: SERVICE_NAME,
				method: "processEscalations",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	/**
	 * Check if a monitor needs escalation and send email
	 */
	private checkAndSendEscalation = async (monitor: Monitor): Promise<void> => {
		try {
			console.log(`[ESCALATION] Checking monitor ${monitor.name} (${monitor.id})`);
			console.log(`[ESCALATION] Monitor status: ${monitor.status}`);
			console.log(`[ESCALATION] Escalation enabled: ${monitor.escalationEnabled}`);
			console.log(`[ESCALATION] Escalation delay: ${monitor.escalationDelay} minutes`);
			console.log(`[ESCALATION] Escalation recipients: ${monitor.escalationRecipients?.join(', ') || 'none'}`);

			// Check if monitor is currently down
			if (monitor.status !== "down") {
				console.log(`[ESCALATION] Monitor ${monitor.name} is not down (status: ${monitor.status}), skipping`);
				return;
			}

			// Get the most recent active incident for this monitor
			const incident = await IncidentModel.findOne({
				monitorId: monitor.id,
				status: true, // Active incident
			}).sort({ startTime: -1 });

			console.log(`[ESCALATION] Found incident for monitor ${monitor.name}: ${incident ? 'YES' : 'NO'}`);
			if (incident) {
				console.log(`[ESCALATION] Incident ID: ${incident._id}`);
				console.log(`[ESCALATION] Incident start time: ${incident.startTime}`);
				console.log(`[ESCALATION] Incident escalation sent: ${incident.escalationSentAt ? 'YES' : 'NO'}`);
			}

			if (!incident) {
				console.log(`[ESCALATION] No active incident found for monitor ${monitor.name}, skipping`);
				return;
			}

			// Calculate downtime duration
			const downtimeDuration = Date.now() - incident.startTime.getTime();
			const escalationDelayMs = (monitor.escalationDelay || 60) * 60 * 1000; // Convert minutes to ms

			console.log(`[ESCALATION] Downtime duration: ${downtimeDuration}ms (${this.formatDuration(downtimeDuration)})`);
			console.log(`[ESCALATION] Escalation delay threshold: ${escalationDelayMs}ms (${this.formatDuration(escalationDelayMs)})`);

			// Check if downtime exceeds escalation delay
			if (downtimeDuration < escalationDelayMs) {
				console.log(`[ESCALATION] Downtime (${this.formatDuration(downtimeDuration)}) is less than threshold (${this.formatDuration(escalationDelayMs)}), skipping`);
				return;
			}

			console.log(`[ESCALATION] Downtime exceeds threshold, checking if escalation already sent`);

			// Check if escalation was already sent for this incident
			if (incident.escalationSentAt) {
				console.log(`[ESCALATION] Escalation already sent at ${incident.escalationSentAt}, skipping`);
				return; // Already sent
			}

			console.log(`[ESCALATION] Sending escalation email for monitor ${monitor.name}`);

			// Send escalation emails
			await this.sendEscalationEmail(monitor, incident);

			// Mark escalation as sent
			await IncidentModel.findByIdAndUpdate(incident._id, {
				escalationSentAt: new Date(),
			});

			console.log(`[ESCALATION] Escalation email sent and incident marked for monitor ${monitor.name}`);

			this.logger.info({
				message: `Escalation email sent for monitor: ${monitor.name} (${monitor.id})`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalation",
			});
		} catch (error) {
			console.error(`[ESCALATION] Error in checkAndSendEscalation for monitor ${monitor.name}:`, error);
			this.logger.error({
				message: `Error checking escalation for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalation",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	/**
	 * Send escalation email to configured recipients
	 */
	private sendEscalationEmail = async (monitor: Monitor, incident: Incident): Promise<void> => {
		try {
			const escalationRecipients = monitor.escalationRecipients || [];

			console.log(`[ESCALATION] Sending escalation email for monitor ${monitor.name}`);
			console.log(`[ESCALATION] Recipients: ${escalationRecipients.join(', ') || 'none'}`);

			if (!escalationRecipients || escalationRecipients.length === 0) {
				console.log(`[ESCALATION] No escalation recipients configured for monitor ${monitor.name}, skipping`);
				this.logger.warn({
					message: `No escalation recipients configured for monitor: ${monitor.name}`,
					service: SERVICE_NAME,
					method: "sendEscalationEmail",
				});
				return;
			}

			const downtimeDuration = this.formatDuration(Date.now() - incident.startTime.getTime());

			console.log(`[ESCALATION] Creating escalation notification message`);
			console.log(`[ESCALATION] Downtime duration: ${downtimeDuration}`);

			// Create escalation notification
			const escalationNotification: Partial<Notification> = {
				type: "email",
				address: escalationRecipients.join(","),
				notificationName: `Escalation: ${monitor.name}`,
			};

			// Create proper NotificationMessage object for email provider
			const notificationMessage: NotificationMessage = {
				type: "monitor_down", // Using monitor_down as the closest type
				severity: "critical",
				monitor: {
					id: monitor.id,
					name: monitor.name,
					url: monitor.url || "N/A",
					type: monitor.type,
					status: monitor.status,
				},
				content: {
					title: `🚨 ESCALATION: ${monitor.name} has been down for ${downtimeDuration}`,
					summary: `Monitor: ${monitor.name}\nURL: ${monitor.url || "N/A"}\nStatus: ${monitor.status}\nDown Since: ${incident.startTime.toISOString()}\nDowntime Duration: ${downtimeDuration}\nEscalation Threshold: ${monitor.escalationDelay || 60} minutes\n\n⚠️ This service has exceeded your escalation threshold and requires immediate attention.`,
					timestamp: new Date(),
				},
				clientHost: this.settingsService.getSettings().clientHost || "Host not defined",
				metadata: {
					teamId: monitor.teamId || "",
					notificationReason: "escalation",
					monitorId: monitor.id,
				},
			};

			console.log(`[ESCALATION] Calling email provider to send message`);
			console.log(`[ESCALATION] Email notification:`, escalationNotification);
			console.log(`[ESCALATION] Notification message:`, JSON.stringify(notificationMessage, null, 2));

			const result = await this.emailProvider.sendMessage!(escalationNotification as Notification, notificationMessage);
			console.log(`[ESCALATION] Email provider result: ${result}`);

			if (result) {
				console.log(`[ESCALATION] Escalation email sent successfully for monitor ${monitor.name}`);
			} else {
				console.log(`[ESCALATION] Escalation email failed to send for monitor ${monitor.name}`);
			}
		} catch (error) {
			console.error(`[ESCALATION] Error sending escalation email for monitor ${monitor.name}:`, error);
			this.logger.error({
				message: "Error sending escalation email",
				service: SERVICE_NAME,
				method: "sendEscalationEmail",
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};

	/**
	 * Format milliseconds to readable duration
	 */
	private formatDuration = (ms: number): string => {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h`;
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
	};
}
