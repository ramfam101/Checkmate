const SERVICE_NAME = "EscalationService";

import type { Monitor } from "@/types/monitor.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import type { IIncidentsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";

export interface IEscalationService {
	handleEscalation(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private notificationsService: INotificationsService;

	constructor(logger: ILogger, incidentsRepository: IIncidentsRepository, notificationsService: INotificationsService) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.notificationsService = notificationsService;
	}

	handleEscalation = async (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): Promise<void> => {
		// Only escalate when monitor is actively down or breached
		if (monitor.status !== "down" && monitor.status !== "breached") {
			return;
		}

		const policy = monitor.escalationPolicy;
		if (!policy || policy.length === 0) {
			return;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return;
		}

		const elapsedMs = Date.now() - new Date(activeIncident.startTime).getTime();
		const sentTiers = activeIncident.escalationsSent ?? [];
		const newlySent: number[] = [];

		for (let i = 0; i < policy.length; i++) {
			const tier = policy[i];
			if (!tier) continue;

			const thresholdMs = tier.delay * 60 * 1000;

			if (elapsedMs >= thresholdMs && !sentTiers.includes(i)) {
				try {
					await this.notificationsService.sendEscalatedNotifications(monitor, monitorStatusResponse, tier.notifications);
					newlySent.push(i);
					this.logger.info({
						message: `Escalation tier ${i} fired for monitor ${monitor.id} after ${tier.delay} minute(s)`,
						service: SERVICE_NAME,
						method: "handleEscalation",
						details: { monitorId: monitor.id, tierIndex: i, delay: tier.delay },
					});
				} catch (error: unknown) {
					this.logger.error({
						message: `Failed to send escalated notifications for tier ${i} on monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "handleEscalation",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		}

		if (newlySent.length > 0) {
			const updatedEscalationsSent = [...sentTiers, ...newlySent];
			await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, {
				escalationsSent: updatedEscalationsSent,
			});
		}
	};
}
