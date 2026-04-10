import type { Monitor } from "@/types/monitor.js";
import type { Incident } from "@/types/incident.js";
import type { Notification } from "@/types/notification.js";
import type { IIncidentsRepository } from "@/repositories/index.js";
import type { IMonitorsRepository } from "@/repositories/index.js";
import type { INotificationsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";
import { AppError } from "@/utils/AppError.js";

export interface IEscalationService {
	getEscalationCheckJob(): () => Promise<void>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	constructor(
		private readonly incidentsRepository: IIncidentsRepository,
		private readonly monitorsRepository: IMonitorsRepository,
		private readonly notificationsRepository: INotificationsRepository,
		private readonly notificationsService: INotificationsService,
		private readonly logger: ILogger
	) {}

	getEscalationCheckJob = (): (() => Promise<void>) => {
		return async () => {
			const now = new Date();
			let activeIncidents: Incident[];
			try {
				activeIncidents = await this.incidentsRepository.findActiveWithPendingEscalations(now);
			} catch (error) {
				this.logger.error({ message: "Failed to fetch active incidents for escalation check", service: SERVICE_NAME });
				return;
			}

			for (const incident of activeIncidents) {
				try {
					await this.processIncident(incident, now);
				} catch (error) {
					this.logger.warn({
						message: `Error processing escalations for incident ${incident.id}`,
						service: SERVICE_NAME,
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		};
	};

	private processIncident = async (incident: Incident, now: Date): Promise<void> => {
		if (!incident.status) return;

		let monitor: Monitor;
		try {
			monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
		} catch {
			return;
		}

		const incidentStart = new Date(incident.startTime).getTime();
		const firedChannelIds = new Set((incident.escalationsFired ?? []).map((r) => r.channelId));

		for (const config of monitor.notifications) {
			for (const escalation of config.escalations) {
				const fireAfter = incidentStart + escalation.delayMinutes * 60_000;
				if (now.getTime() < fireAfter) continue;
				if (firedChannelIds.has(escalation.channelId)) continue;

				const freshIncident = await this.incidentsRepository.findActiveByIncidentId(incident.id, incident.teamId);
				if (!freshIncident) continue;

				let notification: Notification;
				try {
					notification = await this.notificationsRepository.findById(escalation.channelId, monitor.teamId);
				} catch (error) {
					if (error instanceof AppError && error.status === 404) {
						this.logger.warn({ message: `Escalation channel ${escalation.channelId} not found, skipping`, service: SERVICE_NAME });
					}
					continue;
				}

				await this.incidentsRepository.markEscalationFired(incident.id, escalation.channelId, now);
				firedChannelIds.add(escalation.channelId);

				try {
					await this.notificationsService.sendEscalationNotification(notification, monitor, incident);
				} catch (error) {
					this.logger.error({
						message: `Failed to send escalation to channel ${escalation.channelId} for incident ${incident.id}`,
						service: SERVICE_NAME,
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		}
	};
}
