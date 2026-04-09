import type { Incident } from "@/types/incident.js";
import type { EscalationNotification } from "@/types/notification.js";
import { AppError } from "@/utils/AppError.js";
import type { IEscalationNotificationsRepository, IIncidentsRepository, IMonitorsRepository, IEscalationNotificationLogsRepository, ITeamsRepository } from "@/repositories/index.js";
import type { ILogger } from "@/utils/logger.js";
import type { IEmailService } from "@/service/infrastructure/emailService.js";

export interface IEscalationService {
	processEscalationNotifications(): Promise<void>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private escalationNotificationsRepository: IEscalationNotificationsRepository;
	private monitorsRepository: IMonitorsRepository;
	private teamsRepository: ITeamsRepository;
	private emailService: IEmailService;
	private escalationLogsRepository: IEscalationNotificationLogsRepository;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		escalationNotificationsRepository: IEscalationNotificationsRepository,
		monitorsRepository: IMonitorsRepository,
		teamsRepository: ITeamsRepository,
		emailService: IEmailService,
		escalationLogsRepository: IEscalationNotificationLogsRepository
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.escalationNotificationsRepository = escalationNotificationsRepository;
		this.monitorsRepository = monitorsRepository;
		this.teamsRepository = teamsRepository;
		this.emailService = emailService;
		this.escalationLogsRepository = escalationLogsRepository;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	processEscalationNotifications = async (): Promise<void> => {
		try {
			this.logger.info({
				message: "Starting escalation notification processing",
				service: SERVICE_NAME,
				method: "processEscalationNotifications",
			});

			// Find all active incidents
			const activeIncidents = await this.incidentsRepository.findAllActive();

			this.logger.info({
				message: `Found ${activeIncidents.length} active incidents`,
				service: SERVICE_NAME,
				method: "processEscalationNotifications",
			});

			// Process each incident
			for (const incident of activeIncidents) {
				await this.processIncidentEscalations(incident);
			}

			this.logger.info({
				message: "Completed escalation notification processing",
				service: SERVICE_NAME,
				method: "processEscalationNotifications",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error processing escalation notifications: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "processEscalationNotifications",
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};

	private processIncidentEscalations = async (incident: Incident): Promise<void> => {
		try {
			// Calculate elapsed time since incident started
			const incidentStartTime = new Date(incident.startTime);
			const now = new Date();
			const elapsedSeconds = Math.floor((now.getTime() - incidentStartTime.getTime()) / 1000);

			this.logger.debug({
				message: `Processing incident ${incident.id} - elapsed: ${elapsedSeconds}s`,
				service: SERVICE_NAME,
				method: "processIncidentEscalations",
			});

			// Find active escalation notifications for this monitor, sorted by escalation level
			const escalationNotifications = await this.escalationNotificationsRepository.findActiveByMonitorId(incident.monitorId);

			// Sort by escalation level ascending (1, 2, 3, etc.)
			escalationNotifications.sort((a, b) => a.escalationLevel - b.escalationLevel);

			// Find the highest escalation level that should trigger now and hasn't been sent
			let escalationToSend: EscalationNotification | null = null;
			for (const escalation of escalationNotifications) {
				const shouldTrigger = elapsedSeconds >= escalation.delaySeconds;
				const hasBeenSent = await this.hasEscalationBeenSent(incident.id, escalation.id);

				if (shouldTrigger && !hasBeenSent) {
					// Found a qualifying escalation - keep the highest level one
					if (!escalationToSend || escalation.escalationLevel > escalationToSend.escalationLevel) {
						escalationToSend = escalation;
					}
				}
				// Continue checking all escalations to find the highest qualifying one
			}

			if (escalationToSend) {
				this.logger.debug({
					message: `Found escalation level ${escalationToSend.escalationLevel} to send for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processIncidentEscalations",
				});

				await this.processEscalation(incident, escalationToSend, elapsedSeconds);
			} else {
				this.logger.debug({
					message: `No new escalations to send for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processIncidentEscalations",
				});
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error processing escalations for incident ${incident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "processIncidentEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private processEscalation = async (
		incident: Incident,
		escalation: EscalationNotification,
		elapsedSeconds: number
	): Promise<void> => {
		try {
			// Check if this escalation has already been sent for this incident
			const hasBeenSent = await this.hasEscalationBeenSent(incident.id, escalation.id);

			if (hasBeenSent) {
				this.logger.debug({
					message: `Escalation ${escalation.id} already sent for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processEscalation",
				});
				return;
			}

			this.logger.info({
				message: `Sending escalation notification for incident ${incident.id}, escalation level ${escalation.escalationLevel}`,
				service: SERVICE_NAME,
				method: "processEscalation",
			});

			// Send the notification based on channel
			const success = await this.sendEscalationNotification(incident, escalation);

			// Log the notification attempt
			await this.logEscalationNotification(incident.id, escalation.id, escalation.notificationChannel, success);

			if (success) {
				this.logger.info({
					message: `Successfully sent escalation notification for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processEscalation",
				});
			} else {
				this.logger.warn({
					message: `Failed to send escalation notification for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processEscalation",
				});
			}
		} catch (error: unknown) {
			this.logger.error({
				message: `Error processing escalation ${escalation.id} for incident ${incident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "processEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private hasEscalationBeenSent = async (incidentId: string, escalationId: string): Promise<boolean> => {
		try {
			return await this.escalationLogsRepository.hasBeenSent(incidentId, escalationId);
		} catch (error: unknown) {
			this.logger.error({
				message: `Error checking if escalation has been sent: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "hasEscalationBeenSent",
			});
			return false; // If we can't check, assume it hasn't been sent to be safe
		}
	};

	private sendEscalationNotification = async (incident: Incident, escalation: EscalationNotification): Promise<boolean> => {
		try {
			// Get monitor details for context
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);

			// Get team email for notifications
			const team = await this.teamsRepository.findById(incident.teamId);
			const recipientEmail = team?.email || "admin@example.com"; // Fallback to hardcoded if team email not found

			const subject = `ESCALATION: Monitor ${monitor.name} incident - Level ${escalation.escalationLevel}`;
			const html = await this.buildEscalationEmail(incident, escalation, monitor);

			// For now, only support email channel
			if (escalation.notificationChannel === "email") {
				const messageId = await this.emailService.sendEmail(recipientEmail, subject, html);
				return !!messageId;
			}

			// TODO: Add support for other notification channels (Slack, Discord, etc.)

			this.logger.warn({
				message: `Unsupported notification channel: ${escalation.notificationChannel}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
			});
			return false;
		} catch (error: unknown) {
			this.logger.error({
				message: `Error sending escalation notification: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
	};

	private buildEscalationEmail = async (incident: Incident, escalation: EscalationNotification, monitor: any): Promise<string> => {
		const context = {
			incidentId: incident.id,
			monitorName: monitor.name,
			monitorUrl: monitor.url,
			escalationLevel: escalation.escalationLevel,
			delaySeconds: escalation.delaySeconds,
			startTime: incident.startTime,
			message: incident.message || "No additional details",
			statusCode: incident.statusCode || "Unknown",
		};

		// Use the unified notification template or create a specific escalation template
		const html = await this.emailService.buildEmail("unifiedNotificationTemplate", {
			title: `Monitor Escalation - Level ${escalation.escalationLevel}`,
			summary: `Monitor ${monitor.name} has been down for ${escalation.delaySeconds} seconds`,
			monitorName: monitor.name,
			monitorUrl: monitor.url,
			headerColor: "red",
			details: `Incident started at ${incident.startTime}. Status code: ${incident.statusCode}`,
		});

		return html || `Monitor ${monitor.name} escalation level ${escalation.escalationLevel} - incident started at ${incident.startTime}`;
	};

	private logEscalationNotification = async (
		incidentId: string,
		escalationId: string,
		channel: string,
		success: boolean
	): Promise<void> => {
		try {
			await this.escalationLogsRepository.create({
				incidentId,
				escalationNotificationId: escalationId,
				sentAt: new Date(),
				notificationChannel: channel,
				status: success ? "sent" : "failed",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error logging escalation notification: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "logEscalationNotification",
			});
		}
	};
}