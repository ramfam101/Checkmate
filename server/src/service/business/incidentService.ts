const SERVICE_NAME = "incidentService";
import type { Monitor } from "@/types/monitor.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import { AppError } from "@/utils/AppError.js";
import { getDateForRange } from "@/utils/dataUtils.js";
import type { IIncidentsRepository, IMonitorsRepository, IUsersRepository, INotificationsRepository } from "@/repositories/index.js";
import type { Incident, IncidentSummary, User } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ISuperSimpleQueue } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueue.js";
import type { ILogger } from "@/utils/logger.js";

export interface IIncidentService {
	handleIncident(
		monitor: Monitor,
		code: number,
		decision: MonitorActionDecision,
		monitorStatusResponse?: MonitorStatusResponse
	): Promise<Incident | null>;
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
	private notificationsRepository: INotificationsRepository;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private queueService: ISuperSimpleQueue;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		usersRepository: IUsersRepository,
		notificationsRepository: INotificationsRepository,
		notificationMessageBuilder: INotificationMessageBuilder,
		queueService: ISuperSimpleQueue
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.usersRepository = usersRepository;
		this.notificationsRepository = notificationsRepository;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.queueService = queueService;
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
		this.logger.debug({
			message: `handleIncident called for monitor ${monitor.id} (${monitor.name}), shouldCreate: ${decision.shouldCreateIncident}, shouldResolve: ${decision.shouldResolveIncident}`,
			service: SERVICE_NAME,
			method: "handleIncident",
			details: { monitorId: monitor.id, decision },
		});

		if (!decision.shouldCreateIncident && !decision.shouldResolveIncident) {
			return null;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);

		if (decision.shouldCreateIncident) {
			if (activeIncident) {
				this.logger.debug({
					message: `Active incident already exists for monitor ${monitor.id}, returning existing incident`,
					service: SERVICE_NAME,
					method: "handleIncident",
					details: { incidentId: activeIncident.id },
				});
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
					startTime: new Date().toISOString(),
					status: true,
					statusCode,
					message,
				};

				this.logger.info({
					message: `Creating incident for monitor ${monitor.id} with status code ${statusCode}`,
					service: SERVICE_NAME,
					method: "handleIncident",
					details: { monitorId: monitor.id, statusCode },
				});

				const createdIncident = await this.incidentsRepository.create(incident);

				this.logger.info({
					message: `Incident created successfully: ${createdIncident.id}`,
					service: SERVICE_NAME,
					method: "handleIncident",
					details: { incidentId: createdIncident.id, monitorId: monitor.id },
				});

				// Schedule escalation notifications asynchronously without blocking
				this.scheduleEscalationNotifications(monitor, createdIncident).catch((error: unknown) => {
					this.logger.error({
						message: `Failed to schedule escalation notifications for incident ${createdIncident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "handleIncident",
						details: { incidentId: createdIncident.id, monitorId: monitor.id },
						stack: error instanceof Error ? error.stack : undefined,
					});
				});

				return createdIncident;
			}
		}

		if (decision.shouldResolveIncident) {
			if (!activeIncident) {
				this.logger.debug({
					message: `No active incident to resolve for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleIncident",
				});
				return null;
			}

			this.logger.info({
				message: `Resolving incident ${activeIncident.id} for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "handleIncident",
				details: { incidentId: activeIncident.id },
			});

			activeIncident.status = false;
			activeIncident.endTime = new Date().toISOString();
			activeIncident.resolutionType = "automatic";
			const resolved = await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, activeIncident);

			this.logger.info({
				message: `Incident resolved: ${activeIncident.id}`,
				service: SERVICE_NAME,
				method: "handleIncident",
			});

			return resolved;
		}

		return null;
	};

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

	private scheduleEscalationNotifications = async (monitor: Monitor, incident: Incident) => {
		try {
			// Check if monitor has escalation notifications configured
			const escalationNotificationIds = monitor.escalationNotifications ?? [];

			this.logger.debug({
				message: `Checking escalation config for monitor ${monitor.id}: escalationNotifications=${escalationNotificationIds.length}, escalationDelay=${monitor.escalationDelay}`,
				service: SERVICE_NAME,
				method: "scheduleEscalationNotifications",
				details: { monitorId: monitor.id, escalationNotificationCount: escalationNotificationIds.length, escalationDelay: monitor.escalationDelay },
			});

			const delayMinutes = Number(monitor.escalationDelay);
			if (escalationNotificationIds.length === 0 || !Number.isFinite(delayMinutes) || delayMinutes <= 0) {
				this.logger.debug({
					message: `Escalation not configured for monitor ${monitor.id} (no notifications or invalid delay)`,
					service: SERVICE_NAME,
					method: "scheduleEscalationNotifications",
					details: { monitorId: monitor.id, escalationNotificationCount: escalationNotificationIds.length, delayMinutes },
				});
				return;
			}

			// Schedule escalation job for the monitor
			await this.queueService.addEscalationJob(incident.id, monitor.id, monitor.teamId, delayMinutes);

			this.logger.info({
				message: `Scheduled escalation notification for incident ${incident.id} with ${escalationNotificationIds.length} notification(s) after ${monitor.escalationDelay} minutes`,
				service: SERVICE_NAME,
				method: "scheduleEscalationNotifications",
				details: {
					incidentId: incident.id,
					monitorId: monitor.id,
					notificationCount: escalationNotificationIds.length,
					delayMinutes: monitor.escalationDelay,
				},
			});
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "scheduleEscalationNotifications",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

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
			incident.endTime = new Date().toISOString();

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
