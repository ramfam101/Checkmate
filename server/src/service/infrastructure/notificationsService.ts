import type { Monitor, MonitorStatusResponse, Notification } from "@/types/index.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "./notificationProviders/INotificationProvider.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { IEmailService } from "@/service/index.js";

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
	private emailService: IEmailService;

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
		notificationMessageBuilder: INotificationMessageBuilder,
		emailService: IEmailService
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
		this.emailService = emailService;
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
		const regularNotificationsSent = await this.sendNotifications(monitor, monitorStatusResponse, decision);
		
		// Check for escalations if monitor is still down and has escalation rules
		const escalationsSent = await this.checkAndSendEscalations(monitor, monitorStatusResponse, decision);
		
		return regularNotificationsSent || escalationsSent;
	};

	checkAndSendEscalations = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => {
		// Only check escalations if monitor is currently down and has escalation rules
		if (!monitor.currentIncidentStartTime || !monitor.escalations || monitor.escalations.length === 0) {
			return false;
		}

		const now = Date.now();
		const incidentStartTime = parseInt(monitor.currentIncidentStartTime);
		const minutesDown = (now - incidentStartTime) / (1000 * 60);
		
		let escalationSent = false;
		const firedEscalations = monitor.firedEscalations || [];

		// Check each escalation rule
		for (let i = 0; i < monitor.escalations.length; i++) {
			const escalation = monitor.escalations[i];
			
			if (!escalation) continue;
			
			// Skip if this escalation has already fired
			if (firedEscalations.includes(i)) {
				continue;
			}
			
			// Check if enough time has passed
			if (minutesDown >= escalation.delayMinutes) {
				// Send escalation emails
				const escalationSentForRule = await this.sendEscalationEmails(monitor, monitorStatusResponse, escalation, i);
				if (escalationSentForRule) {
					escalationSent = true;
					// Mark this escalation as fired
					firedEscalations.push(i);
				}
			}
		}

		// Update fired escalations in monitor if any were sent
		if (escalationSent) {
			await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
				firedEscalations
			});
		}

		return escalationSent;
	};

	sendEscalationEmails = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, escalation: any, escalationIndex: number) => {
		// Send email to each contact in the escalation rule
		const emailPromises = escalation.contacts.map(async (email: string) => {
			try {
				const subject = `ESCALATION: ${monitor.name} is still down`;
				const html = `
					<h2>Monitor Escalation Alert</h2>
					<p><strong>${monitor.name}</strong> has been down for ${escalation.delayMinutes} minutes.</p>
					<p>This is an escalation notification.</p>
					<p><strong>Monitor Details:</strong></p>
					<ul>
						<li>URL: ${monitor.url}</li>
						<li>Type: ${monitor.type}</li>
						<li>Status: ${monitorStatusResponse.status ? 'Up' : 'Down'}</li>
						<li>Response Time: ${monitorStatusResponse.responseTime || 'N/A'}ms</li>
					</ul>
					<p>Please check the monitor status and take appropriate action.</p>
				`;
				
				const messageId = await this.emailService.sendEmail(email, subject, html);
				return messageId !== false;
			} catch (error) {
				this.logger.error({
					message: `Failed to send escalation email to ${email} for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
					service: SERVICE_NAME,
					method: "sendEscalationEmails"
				});
				return false;
			}
		});

		const results = await Promise.all(emailPromises);
		const successCount = results.filter(Boolean).length;
		
		if (successCount > 0) {
			this.logger.info({
				message: `Sent escalation ${escalationIndex + 1} for monitor ${monitor.id} to ${successCount}/${escalation.contacts.length} contacts`,
				service: SERVICE_NAME,
				method: "sendEscalationEmails"
			});
		}
		
		return successCount > 0;
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
