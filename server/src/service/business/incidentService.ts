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
	handleEscalation(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<void>;
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

	handleEscalation = async (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<void> => {
		const ESCALATION_BUFFER_MS = 60 * 1000; // 1 minute buffer to avoid timing issues

		// Check if monitor has escalations configured
		if (!monitor.escalations || monitor.escalations.length === 0) {
			return;
		}

		// Get the active incident
		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			this.logger.debug({
				message: `No active incident found for monitor ${monitor.id}, skipping escalation check`,
				service: SERVICE_NAME,
				method: "handleEscalation",
			});
			return;
		}

		// Double-check that incident is still active
		if (!activeIncident.status) {
			this.logger.debug({
				message: `Incident ${activeIncident.id} is not active (status: ${activeIncident.status}), skipping escalation`,
				service: SERVICE_NAME,
				method: "handleEscalation",
			});
			return;
		}

		this.logger.debug({
			message: `Loaded incident ${activeIncident.id} for escalation check: escalationsSent=${JSON.stringify(activeIncident.escalationsSent)}`,
			service: SERVICE_NAME,
			method: "handleEscalation",
		});

		const now = Date.now();
		const incidentStartTime = typeof activeIncident.startTime === "string" 
			? parseInt(activeIncident.startTime, 10) 
			: (activeIncident.startTime as any)?.getTime?.() ?? parseInt(String(activeIncident.startTime), 10);
		
		// Check each escalation rule
		for (const escalation of monitor.escalations) {
			const escalationDelayMs = escalation.delayMinutes * 60 * 1000;
			const escalationTime = incidentStartTime + escalationDelayMs;

			// Skip if escalation time hasn't passed yet (with buffer)
			if (now < (escalationTime + ESCALATION_BUFFER_MS)) {
				this.logger.debug({
					message: `Escalation not ready yet: delay=${escalation.delayMinutes}min, timeUntilEscalation=${Math.ceil((escalationTime - now) / 1000)}s`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
				continue;
			}

			// Check if this escalation has already been sent
			const escalationKey = `${escalation.delayMinutes}-${escalation.channelId}`;

			this.logger.debug({
				message: `Checking escalation: key=${escalationKey}, alreadySent=${activeIncident.escalationsSent.includes(escalationKey)}, sentList=${JSON.stringify(activeIncident.escalationsSent)}`,
				service: SERVICE_NAME,
				method: "handleEscalation",
			});

			if (!activeIncident.escalationsSent.includes(escalationKey)) {
				// Mark escalation as sent BEFORE sending the notification
				activeIncident.escalationsSent.push(escalationKey);
				
				this.logger.debug({
					message: `Marking escalation as sent: key=${escalationKey}, sentList=${JSON.stringify(activeIncident.escalationsSent)}`,
					service: SERVICE_NAME,
					method: "handleEscalation",
				});
				
				try {
					const updatedIncident = await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, activeIncident);
					this.logger.debug({
						message: `Database updated successfully: incident=${updatedIncident.id}, escalationsSent=${JSON.stringify(updatedIncident.escalationsSent)}`,
						service: SERVICE_NAME,
						method: "handleEscalation",
					});
				} catch (updateError) {
					// Log the error and remove from array if update failed
					this.logger.error({
						message: `Failed to update incident with escalation sent: ${updateError instanceof Error ? updateError.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "handleEscalation",
					});
					activeIncident.escalationsSent.pop();
					continue;
				}

				// Send the escalation notification
				const escalationDecision: MonitorActionDecision = {
					shouldCreateIncident: false,
					shouldResolveIncident: false,
					shouldSendNotification: true,
					shouldEscalate: false,
					incidentReason: decision.incidentReason,
					notificationReason: "escalation",
				};

				// Filter to only send to the escalation channel/notification
				const originalNotifications = monitor.notifications;
				monitor.notifications = [escalation.channelId];

				try {
					await this.notificationsService.sendNotifications(monitor, monitorStatusResponse, escalationDecision);
					this.logger.info({
						message: `Escalation sent for incident ${activeIncident.id} to channel ${escalation.channelId} (delay: ${escalation.delayMinutes}min)`,
						service: SERVICE_NAME,
						method: "handleEscalation",
					});
				} catch (notificationError) {
					// Log the error and remove from sent list if sending failed
					this.logger.error({
						message: `Failed to send escalation notification: ${notificationError instanceof Error ? notificationError.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "handleEscalation",
					});
					activeIncident.escalationsSent.pop();
					try {
						await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, activeIncident);
					} catch (rollbackError) {
						this.logger.error({
							message: `Failed to rollback escalation sent status: ${rollbackError instanceof Error ? rollbackError.message : "Unknown error"}`,
							service: SERVICE_NAME,
							method: "handleEscalation",
						});
					}
				} finally {
					// Restore original notifications
					monitor.notifications = originalNotifications;
				}
			}
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
