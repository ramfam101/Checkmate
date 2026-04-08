import type { INotificationEscalationRepository, NotificationEscalation } from "@/repositories/NotificationEscalationRepository.js";
import type { IIncidentsRepository } from "@/repositories/index.js";
import type { INotificationsRepository } from "@/repositories/index.js";
import type { IMonitorsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";
import type { Notification } from "@/types/notification.js";
import type { Incident } from "@/types/incident.js";
import type { Monitor } from "@/types/monitor.js";

const SERVICE_NAME = "EscalationService";

export interface IEscalationService {
	readonly serviceName: string;
	createEscalationTracker(incidentId: string, notificationIds: string[], delayMinutes: number, monitorId: string, teamId: string): Promise<void>;
	checkAndProcessEscalations(): Promise<void>;
	resolveEscalations(incidentId: string): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private escalationRepository: INotificationEscalationRepository;
	private notificationsRepository: INotificationsRepository;
	private notificationsService: INotificationsService;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private logger: ILogger;

	constructor(
		escalationRepository: INotificationEscalationRepository,
		notificationsRepository: INotificationsRepository,
		notificationsService: INotificationsService,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		logger: ILogger
	) {
		this.escalationRepository = escalationRepository;
		this.notificationsRepository = notificationsRepository;
		this.notificationsService = notificationsService;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.logger = logger;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	async createEscalationTracker(
		incidentId: string,
		notificationIds: string[],
		delayMinutes: number,
		monitorId: string,
		teamId: string
	): Promise<void> {
		try {
			if (!notificationIds || notificationIds.length === 0) {
				return;
			}

			for (const notificationId of notificationIds) {
				try {
					await this.escalationRepository.create({
						incidentId,
						notificationId,
						monitorId,
						teamId,
						delayMinutes,
						status: "pending",
					});

					this.logger.debug({
						service: SERVICE_NAME,
						method: "createEscalationTracker",
						message: "Created escalation tracker",
						details: {
							incidentId,
							notificationId,
							delayMinutes,
						},
					});
				} catch (error: unknown) {
					this.logger.warn({
						service: SERVICE_NAME,
						method: "createEscalationTracker",
						message: `Failed to create escalation for notification ${notificationId}`,
						details: { notificationId, teamId },
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "createEscalationTracker",
				message: error instanceof Error ? error.message : "Unknown error",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}

	async checkAndProcessEscalations(): Promise<void> {
		try {
			const pendingEscalations = await this.escalationRepository.findPendingEscalations();

			if (pendingEscalations.length === 0) {
				return;
			}

			this.logger.debug({
				service: SERVICE_NAME,
				method: "checkAndProcessEscalations",
				message: `Found ${pendingEscalations.length} pending escalations to check`,
			});

			for (const escalation of pendingEscalations) {
				try {
					const incident = await this.incidentsRepository.findById(escalation.incidentId, escalation.teamId);

					if (!incident || incident.status === false) {
						await this.escalationRepository.updateStatus(escalation.id, "resolved");
						continue;
					}

					const delayMs = (escalation.delayMinutes ?? 15) * 60 * 1000;
					const incidentStartTime = new Date(incident.startTime).getTime();
					const now = Date.now();

					if (now - incidentStartTime >= delayMs) {
						const escalationNotification = await this.notificationsRepository.findById(escalation.notificationId, escalation.teamId);

						const monitor = await this.monitorsRepository.findById(escalation.monitorId, escalation.teamId);

						await this.notificationsService.sendEscalationNotification(escalationNotification, monitor, incident);

						// FIX: We intentionally DO NOT mark this as escalated anymore.
						// By leaving it 'pending', the queue will send a new email every single minute!
						// await this.escalationRepository.markEscalated(escalation.id);

						this.logger.info({
							service: SERVICE_NAME,
							method: "checkAndProcessEscalations",
							message: "Recurring escalation notification sent",
							details: {
								incidentId: escalation.incidentId,
								monitorId: escalation.monitorId,
							},
						});
					}
				} catch (error: unknown) {
					this.logger.warn({
						service: SERVICE_NAME,
						method: "checkAndProcessEscalations",
						message: `Failed to process escalation ${escalation.id}`,
						details: { escalationId: escalation.id },
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "checkAndProcessEscalations",
				message: error instanceof Error ? error.message : "Unknown error",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}

	async resolveEscalations(incidentId: string): Promise<void> {
		try {
			const escalations = await this.escalationRepository.findByIncidentId(incidentId);

			for (const escalation of escalations) {
				if (escalation.status !== "resolved") {
					await this.escalationRepository.updateStatus(escalation.id, "resolved");
				}
			}
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "resolveEscalations",
				message: error instanceof Error ? error.message : "Unknown error",
				details: { incidentId },
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}
}
