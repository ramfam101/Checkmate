const SERVICE_NAME = "incidentService";
import type { Monitor } from "@/types/monitor.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import { AppError } from "@/utils/AppError.js";
import { getDateForRange } from "@/utils/dataUtils.js";
import type { IIncidentsRepository, IMonitorsRepository, IUsersRepository } from "@/repositories/index.js";
import type { Incident, IncidentSummary, User } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";

export interface IIncidentService {
	handleIncident(
		monitor: Monitor,
		code: number,
		decision: MonitorActionDecision,
		monitorStatusResponse?: MonitorStatusResponse
	): Promise<Incident | null>;
	handleEscalation(incidentId: string, teamId: string, notificationIds?: string[]): Promise<boolean>;
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
	private notificationsService: INotificationsService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		usersRepository: IUsersRepository,
		notificationMessageBuilder: INotificationMessageBuilder,
		notificationsService: INotificationsService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.usersRepository = usersRepository;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.notificationsService = notificationsService;
	}

	get serviceName() {
		return IncidentService.SERVICE_NAME;
	}

	private getEscalationTargets = (monitor: Monitor) => {
		const fallbackDelay = monitor.escalationDelay && monitor.escalationDelay > 0 ? monitor.escalationDelay : 3;
		const targetsByNotificationId = new Map<string, number>();

		for (const target of monitor.escalationNotificationDelays ?? []) {
			if (!target?.notificationId) {
				continue;
			}

			const delay = Number(target.delay);
			if (Number.isFinite(delay) && delay > 0) {
				targetsByNotificationId.set(target.notificationId, delay);
			}
		}

		for (const notificationId of monitor.escalationNotifications ?? []) {
			if (!targetsByNotificationId.has(notificationId)) {
				targetsByNotificationId.set(notificationId, fallbackDelay);
			}
		}

		return Array.from(targetsByNotificationId.entries()).map(([notificationId, delay]) => ({
			notificationId,
			delay,
		}));
	};

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
				const createdIncident = await this.incidentsRepository.create(incident);

				// Schedule escalation if configured
				const escalationTargets = this.getEscalationTargets(monitor);
				if (escalationTargets.length > 0) {
					const notificationIdsByDelay = new Map<number, string[]>();

					for (const target of escalationTargets) {
						const idsForDelay = notificationIdsByDelay.get(target.delay) ?? [];
						notificationIdsByDelay.set(target.delay, [...idsForDelay, target.notificationId]);
					}

					for (const [delay, notificationIds] of notificationIdsByDelay.entries()) {
						const escalationDelayMs = delay * 60 * 1000;

						setTimeout(async () => {
							try {
								await this.handleEscalation(createdIncident.id, monitor.teamId, notificationIds);
							} catch (error: unknown) {
								this.logger.error({
									message: `Failed to handle escalation for incident ${createdIncident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
									service: SERVICE_NAME,
									method: "handleIncident",
									stack: error instanceof Error ? error.stack : undefined,
								});
							}
						}, escalationDelayMs);

						this.logger.info({
							message: `Scheduled escalation for incident ${createdIncident.id} in ${delay} minute(s) for ${notificationIds.length} notification(s)`,
							service: SERVICE_NAME,
							method: "handleIncident",
						});
					}
				}

				return createdIncident;
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

	handleEscalation = async (incidentId: string, teamId: string, notificationIds?: string[]): Promise<boolean> => {
		try {
			// Get the incident
			const incident = await this.incidentsRepository.findById(incidentId, teamId);

			// Check if escalation was already sent
			if (incident.escalationSent) {
				this.logger.info({
					message: `Escalation already sent for incident ${incidentId}`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
				return false;
			}

			// Check if incident is still active
			if (!incident.status) {
				this.logger.info({
					message: `Incident ${incidentId} is no longer active, skipping escalation`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
				return false;
			}

			// Get the monitor
			const monitor = await this.monitorsRepository.findById(incident.monitorId, teamId);

			const escalationTargets = this.getEscalationTargets(monitor);
			if (escalationTargets.length === 0) {
				this.logger.info({
					message: `No escalation notifications configured for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
				return false;
			}

			const configuredNotificationIds = escalationTargets.map((target) => target.notificationId);
			const targetNotificationIds = (notificationIds?.length ? notificationIds : configuredNotificationIds).filter((id) =>
				configuredNotificationIds.includes(id)
			);

			if (targetNotificationIds.length === 0) {
				this.logger.info({
					message: `No matching escalation notifications are due for monitor ${monitor.id}`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
				return false;
			}

			// Create a mock MonitorStatusResponse for escalation (we don't have the actual response)
			const mockStatusResponse: MonitorStatusResponse = {
				monitorId: monitor.id,
				teamId: monitor.teamId,
				type: monitor.type,
				status: monitor.status === "up", // Convert monitor status to boolean
				code: incident.statusCode || 0,
				message: incident.message || "Escalation triggered",
				responseTime: 0,
			};

			// Create escalation decision
			const escalationDecision: MonitorActionDecision = {
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "status_change", // Use status_change for escalation notifications
			};

			const finalDelay = Math.max(...escalationTargets.map((target) => target.delay));
			const finalNotificationIds = escalationTargets
				.filter((target) => target.delay === finalDelay)
				.map((target) => target.notificationId);
			const isFinalEscalationBatch =
				!notificationIds?.length ||
				(targetNotificationIds.length === finalNotificationIds.length &&
					targetNotificationIds.every((id) => finalNotificationIds.includes(id)));

			const success = await this.notificationsService.handleNotifications(
				{
					...monitor,
					escalationNotifications: targetNotificationIds,
				},
				mockStatusResponse,
				escalationDecision,
				true
			);

			if (success && isFinalEscalationBatch) {
				incident.escalationSent = true;
				incident.escalationTime = Date.now().toString();
				await this.incidentsRepository.updateById(incident.id, teamId, incident);
			}

			if (success) {
				this.logger.info({
					message: `Escalation notifications sent successfully for incident ${incidentId}`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
			}

			return success;
		} catch (error: unknown) {
			this.logger.error({
				message: `Error handling escalation for incident ${incidentId}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "handleEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
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
