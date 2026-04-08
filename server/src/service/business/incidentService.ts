const SERVICE_NAME = "incidentService";
import type { Monitor, MonitorEscalation } from "@/types/monitor.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import { AppError } from "@/utils/AppError.js";
import { getDateForRange } from "@/utils/dataUtils.js";
import type { IIncidentsRepository, IMonitorsRepository, IUsersRepository } from "@/repositories/index.js";
import type { Incident, IncidentSummary, User } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ILogger } from "@/utils/logger.js";

export interface IIncidentService {
	handleIncident(
		monitor: Monitor,
		code: number,
		decision: MonitorActionDecision,
		monitorStatusResponse?: MonitorStatusResponse
	): Promise<Incident | null>;
	getDueEscalationRules(monitor: Monitor): Promise<{ dueEscalations: MonitorEscalation[]; incidentDurationMinutes: number }>;
	resolveIncident(incidentId: string, userId: string, teamId: string, comment?: string, userEmail?: string): Promise<Incident>;
	getIncidentsByTeam(
		teamId: string,
		sortOrder: string,
		dateRange: string,
		page: number,
		rowsPerPage: number,
		status: boolean | undefined,
		monitorId: string | undefined,
		resolutionType: string | undefined
	): Promise<{ incidents: Incident[]; count: number }>;
	getIncidentSummary(teamId: string, limit?: number): Promise<IncidentSummary>;
	getIncidentById(incidentId: string, teamId: string): Promise<{ incident: Incident; monitor: Monitor; user: User | null }>;
}

export class IncidentService implements IIncidentService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private usersRepository: IUsersRepository;
	private notificationMessageBuilder: INotificationMessageBuilder;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		usersRepository: IUsersRepository,
		notificationMessageBuilder: INotificationMessageBuilder
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.usersRepository = usersRepository;
		this.notificationMessageBuilder = notificationMessageBuilder;
	}

	get serviceName() {
		return IncidentService.SERVICE_NAME;
	}

	handleIncident = async (
		monitor: Monitor,
		code: number,
		decision: MonitorActionDecision,
		monitorStatusResponse?: MonitorStatusResponse
	): Promise<Incident | null> => {
		if (!decision.shouldCreateIncident && !decision.shouldResolveIncident) {
			return null;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);

		if (decision.shouldCreateIncident) {
			if (activeIncident) {
				return activeIncident;
			} else {
				let statusCode = code;
				let message: string | undefined;

				// For threshold breaches, use 9999 status code and build descriptive message
				if (decision.incidentReason === "threshold_breach") {
					statusCode = 9999;
					message = this.buildThresholdBreachMessage(monitor, monitorStatusResponse);
				}

				const incident = {
					monitorId: monitor.id,
					teamId: monitor.teamId,
					startTime: Date.now().toString(),
					status: true,
					statusCode,
					message,
				};
				return await this.incidentsRepository.create(incident);
			}
		}

		if (decision.shouldResolveIncident) {
			if (!activeIncident) {
				return null;
			}
			activeIncident.status = false;
			activeIncident.endTime = Date.now().toString();
			activeIncident.resolutionType = "automatic";
			return await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, activeIncident);
		}

		return null;
	};

	getDueEscalationRules = async (monitor: Monitor): Promise<{ dueEscalations: MonitorEscalation[]; incidentDurationMinutes: number }> => {
		if (monitor.status !== "down" && monitor.status !== "breached") {
			return { dueEscalations: [], incidentDurationMinutes: 0 };
		}

		const escalation = this.normalizeEscalation(monitor.escalation ?? []);
		if (escalation.length === 0) {
			return { dueEscalations: [], incidentDurationMinutes: 0 };
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return { dueEscalations: [], incidentDurationMinutes: 0 };
		}

		const isUnacknowledged = activeIncident.status === true && activeIncident.resolutionType === null;
		if (!isUnacknowledged) {
			return { dueEscalations: [], incidentDurationMinutes: 0 };
		}

		const incidentStartedAt = new Date(activeIncident.startTime).getTime();
		if (!Number.isFinite(incidentStartedAt)) {
			return { dueEscalations: [], incidentDurationMinutes: 0 };
		}

		const incidentDurationMinutes = Math.max(0, Math.floor((Date.now() - incidentStartedAt) / 60000));
		const alreadyNotified = new Set(activeIncident.escalationNotifiedChannels ?? []);

		const dueEscalations = escalation.filter((entry) => {
			const key = this.buildEscalationDeliveryKey(entry.delayMinutes, entry.channelId);
			return entry.delayMinutes <= incidentDurationMinutes && !alreadyNotified.has(key);
		});
		if (dueEscalations.length === 0) {
			return { dueEscalations: [], incidentDurationMinutes };
		}

		const nextNotifiedChannels = Array.from(
			new Set([
				...(activeIncident.escalationNotifiedChannels ?? []),
				...dueEscalations.map((entry) => this.buildEscalationDeliveryKey(entry.delayMinutes, entry.channelId)),
			])
		).sort();

		await this.incidentsRepository.updateById(activeIncident.id, monitor.teamId, {
			escalationNotifiedChannels: nextNotifiedChannels,
		});

		return {
			dueEscalations,
			incidentDurationMinutes,
		};
	};

	private normalizeEscalation(entries: MonitorEscalation[]): MonitorEscalation[] {
		const unique = new Set<string>();
		const normalized: MonitorEscalation[] = [];

		for (const entry of entries) {
			const delayMinutes = Number(entry.delayMinutes);
			const channelId = String(entry.channelId ?? "").trim();
			if (!Number.isFinite(delayMinutes) || delayMinutes < 1 || !channelId) {
				continue;
			}
			const key = this.buildEscalationDeliveryKey(delayMinutes, channelId);
			if (unique.has(key)) {
				continue;
			}
			unique.add(key);
			normalized.push({ delayMinutes, channelId });
		}

		return normalized.sort((a, b) => a.delayMinutes - b.delayMinutes);
	}

	private buildEscalationDeliveryKey(delayMinutes: number, channelId: string): string {
		return `${delayMinutes}:${channelId}`;
	}

	private buildThresholdBreachMessage(monitor: Monitor, monitorStatusResponse?: MonitorStatusResponse): string {
		if (!monitorStatusResponse) {
			return "Threshold breach detected";
		}

		const breaches = this.notificationMessageBuilder.extractThresholdBreaches(monitor, monitorStatusResponse);

		if (breaches.length === 0) {
			return "Threshold breach detected";
		}

		return breaches.map((b) => `${b.metric.toUpperCase()}: ${b.formattedValue} (threshold: ${b.threshold}${b.unit})`).join(", ");
	}

	resolveIncident = async (incidentId: string, userId: string, teamId: string, comment?: string, userEmail?: string) => {
		try {
			if (!incidentId) {
				throw new AppError({ message: "No incident ID in request", service: SERVICE_NAME, method: "resolveIncident" });
			}

			if (!userId) {
				throw new AppError({ message: "No user ID in request", service: SERVICE_NAME, method: "resolveIncident" });
			}

			if (!teamId) {
				throw new AppError({ message: "No team ID in request", service: SERVICE_NAME, method: "resolveIncident" });
			}

			const incident = await this.incidentsRepository.findActiveByIncidentId(incidentId, teamId);

			if (!incident) {
				throw new AppError({ message: "Incident not found", service: SERVICE_NAME, method: "resolveIncident" });
			}

			if (incident.status === false) {
				throw new AppError({ message: "Incident is already resolved", service: SERVICE_NAME, method: "resolveIncident" });
			}

			incident.resolutionType = "manual";
			incident.status = false;
			incident.resolvedBy = userId;
			incident.resolvedByEmail = userEmail || null;
			incident.comment = comment || null;
			incident.endTime = Date.now().toString();

			const resolvedIncident = await this.incidentsRepository.updateById(incident.id, teamId, incident);

			this.logger.debug({
				service: SERVICE_NAME,
				method: "resolveIncidentManually",
				message: `Incident manually resolved by user`,
				details: { incidentId: resolvedIncident.id },
			});

			return resolvedIncident;
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "resolveIncident",
				message: error instanceof Error ? error.message : "Unknown error",
				details: { id: incidentId },
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};

	getIncidentsByTeam = async (
		teamId: string,
		sortOrder: string,
		dateRange: string,
		page: number,
		rowsPerPage: number,
		status: boolean | undefined,
		monitorId: string | undefined,
		resolutionType: string | undefined
	) => {
		try {
			if (!teamId) {
				throw new AppError({ message: "No team ID in request", service: SERVICE_NAME, method: "getIncidentsByTeam", status: 400 });
			}

			const startDate = getDateForRange(dateRange);

			const parsedPage = page ?? 0;
			const parsedRowsPerPage = rowsPerPage ?? 20;

			const incidents = await this.incidentsRepository.findByTeamId(
				teamId,
				startDate,
				parsedPage,
				parsedRowsPerPage,
				sortOrder,
				status,
				monitorId,
				resolutionType
			);

			const count = await this.incidentsRepository.countByTeamId(teamId, startDate, status, monitorId, resolutionType);

			return { incidents, count };
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "getIncidentsByTeam",
				message: error instanceof Error ? error.message : "Unknown error",
				details: { teamId },
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};

	getIncidentSummary = async (teamId: string, limit?: number) => {
		try {
			if (!teamId) {
				throw new AppError({ message: "No team ID in request", service: SERVICE_NAME, method: "getIncidentSummary", status: 400 });
			}

			const parsedLimit = limit ?? 10;
			const summary = await this.incidentsRepository.findSummaryByTeamId(teamId, parsedLimit);

			return summary;
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "getIncidentSummary",
				message: error instanceof Error ? error.message : "Unknown error",
				details: { teamId },
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};

	getIncidentById = async (incidentId: string, teamId: string) => {
		try {
			const incident = await this.incidentsRepository.findById(incidentId, teamId);
			const monitor = await this.monitorsRepository.findById(incident.monitorId, teamId);
			let user = null;
			if (incident.resolvedBy) {
				user = await this.usersRepository.findById(incident.resolvedBy);
			}
			return { incident, monitor, user };
		} catch (error: unknown) {
			this.logger.error({
				service: SERVICE_NAME,
				method: "getIncidentById",
				message: error instanceof Error ? error.message : "Unknown error",
				details: { incidentId },
				stack: error instanceof Error ? error.stack : undefined,
			});
			throw error;
		}
	};
}
