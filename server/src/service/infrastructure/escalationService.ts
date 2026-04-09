const SERVICE_NAME = "EscalationService";
import type { ILogger } from "@/utils/logger.js";
import type { IIncidentsRepository, IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import type { Incident, Monitor, Notification } from "@/types/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";

export interface IEscalationService {
	checkAndSendEscalations(): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private notificationsRepository: INotificationsRepository;
	private notificationsService: INotificationsService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		notificationsRepository: INotificationsRepository,
		notificationsService: INotificationsService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.notificationsRepository = notificationsRepository;
		this.notificationsService = notificationsService;
	}

	checkAndSendEscalations = async (): Promise<void> => {
		try {
			// Get all active incidents
			const activeIncidents = await this.incidentsRepository.findActiveIncidents();

			for (const incident of activeIncidents) {
				await this.processIncidentEscalations(incident);
			}
		} catch (error) {
			this.logger.error({
				message: `Error checking escalations: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "checkAndSendEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private processIncidentEscalations = async (incident: Incident): Promise<void> => {
		try {
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor) {
				return;
			}

			const notificationIds = monitor.escalationNotifications ?? [];
			if (notificationIds.length === 0) {
				return;
			}

			const notifications = await this.notificationsRepository.findNotificationsByIds(notificationIds);

			// Get incident duration in minutes
			const incidentStartTime = new Date(incident.startTime).getTime();
			const currentTime = Date.now();
			const incidentDurationMs = currentTime - incidentStartTime;
			const incidentDurationMinutes = Math.floor(incidentDurationMs / (1000 * 60));

			const sentEscalations = incident.sentEscalations ?? [];

			// Check if escalation delay has been reached
			const escalationDelay = monitor.escalationDelay ?? 0;

			this.logger.debug({
				message: `Escalation check for incident ${incident.id}`,
				service: SERVICE_NAME,
				method: "processIncidentEscalations",
				details: {
					monitorId: monitor.id,
					escalationDelay,
					incidentDurationMinutes,
					sentEscalations,
					escalationNotificationCount: notificationIds.length,
				},
			});

			// If escalation delay is 0 or incident duration is less than delay, skip
			if (escalationDelay === 0) {
				this.logger.debug({
					message: `Escalation skipped because escalationDelay is 0 for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "processIncidentEscalations",
				});
				return;
			}

			if (incidentDurationMinutes < escalationDelay) {
				this.logger.debug({
					message: `Escalation delay not reached yet for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processIncidentEscalations",
					details: {
						incidentDurationMinutes,
						escalationDelay,
					},
				});
				return;
			}

			// Check if this escalation delay has already been sent
			if (sentEscalations.includes(escalationDelay)) {
				this.logger.debug({
					message: `Escalation already sent for delay ${escalationDelay} minutes for incident ${incident.id}`,
					service: SERVICE_NAME,
					method: "processIncidentEscalations",
				});
				return;
			}

			// Send escalation notifications
			for (const notification of notifications) {
				await this.sendEscalationNotification(incident, monitor, notification, escalationDelay);
			}

			// Record that this escalation was sent
			sentEscalations.push(escalationDelay);
			incident.sentEscalations = sentEscalations;
			await this.incidentsRepository.updateById(incident.id, incident.teamId, incident);
		} catch (error) {
			this.logger.error({
				message: `Error processing escalations for incident ${incident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "processIncidentEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationNotification = async (
		incident: Incident,
		monitor: Monitor,
		notification: Notification,
		delayMinutes: number
	): Promise<void> => {
		try {
			// Send escalation notification using the proper notifications service
			const success = await this.notificationsService.sendEscalationNotification(monitor, notification, delayMinutes);

			if (success) {
				this.logger.info({
					message: `Escalation notification sent for incident ${incident.id} (${delayMinutes} minutes)`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
				});
			} else {
				this.logger.error({
					message: `Failed to send escalation notification for incident ${incident.id} (${delayMinutes} minutes)`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
				});
			}
		} catch (error) {
			this.logger.error({
				message: `Error sending escalation notification: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};
}
