const SERVICE_NAME = "escalationService";
import type { Incident } from "@/types/incident.js";
import type { Notification, Monitor } from "@/types/index.js";
import type { IIncidentsRepository, INotificationsRepository, IMonitorsRepository } from "@/repositories/index.js";
import type { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { IEmailService } from "@/service/infrastructure/emailService.js";

export interface IEscalationService {
	processEscalations(): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private notificationsRepository: INotificationsRepository;
	private monitorsRepository: IMonitorsRepository;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private emailService: IEmailService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		notificationsRepository: INotificationsRepository,
		monitorsRepository: IMonitorsRepository,
		notificationMessageBuilder: INotificationMessageBuilder,
		emailService: IEmailService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.notificationsRepository = notificationsRepository;
		this.monitorsRepository = monitorsRepository;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.emailService = emailService;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	processEscalations = async (): Promise<void> => {
		try {
			// Find all active incidents (status: true, endTime: null)
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();

			if (!activeIncidents || activeIncidents.length === 0) {
				this.logger.debug({
					message: "No active incidents found for escalation check",
					service: SERVICE_NAME,
					method: "processEscalations",
				});
				return;
			}

			// Process each active incident
			for (const incident of activeIncidents) {
				await this.checkIncidentEscalations(incident);
			}
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "processEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private checkIncidentEscalations = async (incident: Incident): Promise<void> => {
		try {
			// Get the monitor for this incident
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor) {
				this.logger.warn({
					message: "Monitor not found for incident",
					service: SERVICE_NAME,
					method: "checkIncidentEscalations",
					details: { incidentId: incident.id, monitorId: incident.monitorId },
				});
				return;
			}

			const escalationAfterMinutes = monitor.escalationAfterMinutes ?? null;
			const escalationNotificationIds = monitor.escalationNotificationIds ?? [];

			if (!escalationAfterMinutes || escalationAfterMinutes <= 0 || escalationNotificationIds.length === 0) {
				return;
			}

			const notifications = await this.notificationsRepository.findNotificationsByIds(escalationNotificationIds);
			const escalationNotifications = notifications.filter((n) => n.type === "email" && !!n.address);

			if (escalationNotifications.length === 0) {
				return;
			}

			// Calculate minutes since incident start
			const incidentStartTime = new Date(incident.startTime).getTime();
			const currentTime = Date.now();
			const minutesElapsed = Math.floor((currentTime - incidentStartTime) / (1000 * 60));

			if (minutesElapsed < escalationAfterMinutes) {
				return;
			}

			// Initialize escalationsSent tracking if needed
			const escalationsSent = incident.escalationsSent || {};

			for (const notification of escalationNotifications) {
				const escalationKey = `${notification.id}`;
				if (escalationsSent[escalationKey]) {
					continue;
				}

				const sent = await this.sendEscalationEmail(notification, monitor, incident, minutesElapsed);

				if (sent) {
					escalationsSent[escalationKey] = true;
					await this.incidentsRepository.updateById(incident.id, incident.teamId, { escalationsSent });
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "checkIncidentEscalations",
				details: { incidentId: incident.id },
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationEmail = async (notification: Notification, monitor: Monitor, incident: Incident, minutesElapsed: number): Promise<boolean> => {
		try {
			if (!notification.address) {
				return false;
			}

			// Calculate duration string
			const incidentStartTime = new Date(incident.startTime).getTime();
			const currentTime = Date.now();
			const totalMinutes = Math.floor((currentTime - incidentStartTime) / (1000 * 60));
			const hours = Math.floor(totalMinutes / 60);
			const minutes = totalMinutes % 60;

			let durationStr = "";
			if (hours > 0) {
				durationStr = `${hours} hour${hours > 1 ? "s" : ""} and ${minutes} minute${minutes !== 1 ? "s" : ""}`;
			} else {
				durationStr = `${minutes} minute${minutes !== 1 ? "s" : ""}`;
			}

			// Build escalation message context
			const escalationContext = {
				title: `ESCALATION: ${monitor.name} - Still Down`,
				monitorName: monitor.name,
				monitorUrl: monitor.url,
				monitorType: monitor.type,
				monitorStatus: "DOWN",
				summary: `Your monitor has been down for ${durationStr}. Immediate action is required.`,
				incidentDuration: durationStr,
				incidentStartTime: new Date(incident.startTime).toLocaleString(),
				headerColor: "#FF6B6B",
			};

			// Build email from escalation template
			const html = await this.emailService.buildEmail("escalationNotificationTemplate", escalationContext);

			if (!html) {
				this.logger.warn({
					message: "Failed to build escalation email template",
					service: SERVICE_NAME,
					method: "sendEscalationEmail",
					details: { notificationId: notification.id },
				});
				return false;
			}

			const subject = `[ESCALATION] ${monitor.name} - Still Down - ${durationStr}`;
			const messageId = await this.emailService.sendEmail(notification.address, subject, html);

			if (!messageId) {
				this.logger.warn({
					message: "Failed to send escalation email",
					service: SERVICE_NAME,
					method: "sendEscalationEmail",
					details: { notificationId: notification.id, monitorId: monitor.id },
				});
				return false;
			}

			this.logger.info({
				message: "Escalation email sent successfully",
				service: SERVICE_NAME,
				method: "sendEscalationEmail",
				details: { notificationId: notification.id, monitorId: monitor.id, minutesElapsed },
			});

			return true;
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "sendEscalationEmail",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
	};
}
