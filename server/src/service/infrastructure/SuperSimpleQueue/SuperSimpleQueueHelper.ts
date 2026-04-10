const SERVICE_NAME = "JobQueueHelper";
import type { Monitor } from "@/types/monitor.js";
import { supportsGeoCheck } from "@/types/monitor.js";
//** ADDED IMPORTS FOR INCIDENTS AND MAINTENANCE WINDOWS **//
import type { Incident } from "@/types/incident.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
/////////////////////////////////////////////////////////////
import { AppError } from "@/utils/AppError.js";
import {
	ICheckService,
	INetworkService,
	INotificationsService,
	ISettingsService,
	IStatusService,
	IncidentService,
	type IGeoChecksService,
} from "@/service/index.js";
import { CHECK_TTL_SENTINEL, type MaintenanceWindow, type StatusChangeResult } from "@/types/index.js";
import {
	IMaintenanceWindowsRepository,
	IMonitorsRepository,
	ITeamsRepository,
	IMonitorStatsRepository,
	IChecksRepository,
	IIncidentsRepository,
	INotificationsRepository, //** ADDED REPOSITORY IMPORT FOR GEO CHECKS **//
	IGeoChecksRepository,
} from "@/repositories/index.js";
import { ILogger } from "@/utils/logger.js";
import { IBufferService } from "@/service/index.js";

export interface ISuperSimpleQueueHelper {
	readonly serviceName: string;
	getHeartbeatJob(): (monitor: Monitor) => Promise<void>;
	getHeartbeatGeoJob(): (monitor: Monitor) => Promise<void>;
	getCleanupOrphanedJob(): () => Promise<void>;
	getCleanupRetentionJob(): () => Promise<void>;
	getEscalationCheckJob(): () => Promise<void>; //** ADDED METHOD TO CHECK FOR MAINTENANCE WINDOW **//
	isInMaintenanceWindow(monitorId: string, teamId: string): Promise<boolean>;
}

export interface MonitorActionDecision {
	shouldCreateIncident: boolean;
	shouldResolveIncident: boolean;
	shouldSendNotification: boolean;
	incidentReason: "status_down" | "threshold_breach" | null;
	notificationReason: "status_change" | "threshold_breach" | null;
	thresholdBreaches?: {
		cpu?: boolean;
		memory?: boolean;
		disk?: boolean;
		temp?: boolean;
	};
}

export class SuperSimpleQueueHelper implements ISuperSimpleQueueHelper {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private networkService: INetworkService;
	private statusService: IStatusService;
	private notificationsService: INotificationsService;
	private checkService: ICheckService;
	private settingsService: ISettingsService;
	private buffer: IBufferService;
	private incidentService: IncidentService;
	private maintenanceWindowsRepository: IMaintenanceWindowsRepository;
	private monitorsRepository: IMonitorsRepository;
	private teamsRepository: ITeamsRepository;
	private monitorStatsRepository: IMonitorStatsRepository;
	private checksRepository: IChecksRepository;
	private incidentsRepository: IIncidentsRepository;
	private notificationsRepository: INotificationsRepository; //** ADDED INCIDENTS REPOSITORY **//
	private geoChecksService: IGeoChecksService;
	private geoChecksRepository: IGeoChecksRepository;

	constructor(
		logger: ILogger,
		networkService: INetworkService,
		statusService: IStatusService,
		notificationsService: INotificationsService,
		checkService: ICheckService,
		settingsService: ISettingsService,
		buffer: IBufferService,
		incidentService: IncidentService,
		maintenanceWindowsRepository: IMaintenanceWindowsRepository,
		monitorsRepository: IMonitorsRepository,
		teamsRepository: ITeamsRepository,
		monitorStatsRepository: IMonitorStatsRepository,
		checksRepository: IChecksRepository,
		incidentsRepository: IIncidentsRepository,
		notificationsRepository: INotificationsRepository,//** ADDED INCIDENTS REPOSITORY **//
		geoChecksService: IGeoChecksService,
		geoChecksRepository: IGeoChecksRepository
	) {
		this.logger = logger;
		this.networkService = networkService;
		this.statusService = statusService;
		this.checkService = checkService;
		this.settingsService = settingsService;
		this.buffer = buffer;
		this.notificationsService = notificationsService;
		this.incidentService = incidentService;
		this.maintenanceWindowsRepository = maintenanceWindowsRepository;
		this.monitorsRepository = monitorsRepository;
		this.teamsRepository = teamsRepository;
		this.monitorStatsRepository = monitorStatsRepository;
		this.checksRepository = checksRepository;
		this.incidentsRepository = incidentsRepository;
		this.notificationsRepository = notificationsRepository; //** ADDED INCIDENTS REPOSITORY **//
		this.geoChecksService = geoChecksService;
		this.geoChecksRepository = geoChecksRepository;
	}

	get serviceName() {
		return SuperSimpleQueueHelper.SERVICE_NAME;
	}

	getHeartbeatJob = () => {
		return async (monitor: Monitor) => {
			try {
				const monitorId = monitor.id;
				const teamId = monitor.teamId;
				if (!monitorId) {
					throw new AppError({ message: "No monitor id", service: SERVICE_NAME, method: "getMonitorJob" });
				}

				// Step 1.  Check for maintenance window, if found, skip the check

				const maintenanceWindowActive = await this.isInMaintenanceWindow(monitorId, teamId);
				if (maintenanceWindowActive) {
					this.logger.debug({
						message: `Monitor ${monitorId} is in maintenance window`,
						service: SERVICE_NAME,
						method: "getMonitorJob",
					});
					if (monitor.status !== "maintenance") {
						await this.monitorsRepository.updateById(monitorId, teamId, { status: "maintenance" });
					}
					return;
				}

				// Step 2.  Request monitor status
				const status = await this.networkService.requestStatus(monitor);
				if (!status) {
					throw new Error("No network response");
				}

				// Step 3.  Build check
				const check = this.checkService.buildCheck(status);
				if (!check) {
					this.logger.warn({
						message: `No check could be built for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getMonitorJob",
						details: { code: status.code, message: status.message },
					});
					return;
				}
				// Step 4 Add check to buffer
				this.buffer.addToBuffer(check);
				// Step 4.  Update monitor status
				const statusChangeResult = await this.statusService.updateMonitorStatus(status, check);

				// Step 5.  Get decisions
				const decision = this.evaluateMonitorAction(statusChangeResult);

				// Step 6. Handle notifications (best effort, continue even in event of failure, don't wait)
				if (decision.shouldSendNotification) {
					this.notificationsService.handleNotifications(statusChangeResult.monitor, status, decision).catch((error: unknown) => {
						this.logger.error({
							message: `Error sending notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
							service: SERVICE_NAME,
							method: "getMonitorJob",
							stack: error instanceof Error ? error.stack : undefined,
						});
					});
				}

				// Step 7. Handle incidents (best effort, don't wait)
				this.incidentService.handleIncident(statusChangeResult.monitor, statusChangeResult.code, decision, status).catch((error: unknown) => {
					this.logger.warn({
						message: `Error handling incident for job ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "getMonitorJob",
						stack: error instanceof Error ? error.stack : undefined,
					});
				});
			} catch (error: unknown) {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getMonitorJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error;
			}
		};
	};

	getCleanupOrphanedJob = () => {
		return async () => {
			try {
				this.logger.info({
					message: "Starting cleanup of orphaned data",
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
				});

				// Get all valid team IDs
				const validTeamIds = await this.teamsRepository.findAllTeamIds();
				this.logger.debug({
					message: `Found ${validTeamIds.length} valid teams`,
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
				});

				// Remove orphaned monitors (monitors without a valid team)
				const deletedMonitorCount = await this.monitorsRepository.deleteByTeamIdsNotIn(validTeamIds);
				if (deletedMonitorCount > 0) {
					this.logger.info({
						message: `Deleted ${deletedMonitorCount} orphaned monitors`,
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
				}

				// Remove orphaned monitorStats (stats without a valid monitor)
				const allMonitorIds = await this.monitorsRepository.findAllMonitorIds();
				this.logger.debug({
					message: `Found ${allMonitorIds.length} valid monitors`,
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
				});

				const deletedStatsCount = await this.monitorStatsRepository.deleteByMonitorIdsNotIn(allMonitorIds);
				if (deletedStatsCount > 0) {
					this.logger.info({
						message: `Deleted ${deletedStatsCount} orphaned monitor stats`,
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
				}

				// Remove orphaned checks
				const deletedChecksCount = await this.checksRepository.deleteByMonitorIdsNotIn(allMonitorIds);
				if (deletedChecksCount > 0) {
					this.logger.info({
						message: `Deleted ${deletedChecksCount} orphaned checks`,
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
				}

				// Remove orphaned incidents
				const deletedIncidentsCount = await this.incidentsRepository.deleteByMonitorIdsNotIn(allMonitorIds);
				if (deletedIncidentsCount > 0) {
					this.logger.info({
						message: `Deleted ${deletedIncidentsCount} orphaned incidents`,
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
				}

				// Remove orphaned geo checks
				const deletedGeoChecksCount = await this.geoChecksRepository.deleteByMonitorIdsNotIn(allMonitorIds);
				if (deletedGeoChecksCount > 0) {
					this.logger.info({
						message: `Deleted ${deletedGeoChecksCount} orphaned geo checks`,
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
				}

				this.logger.info({
					message: "Cleanup of orphaned data completed",
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
				});
			} catch (error: unknown) {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error;
			}
		};
	};

	getHeartbeatGeoJob = () => {
		return async (monitor: Monitor) => {
			try {
				const monitorId = monitor.id;
				const teamId = monitor.teamId;

				// Step 1: Validate monitor eligibility
				if (!monitorId) {
					throw new AppError({ message: "No monitor id", service: SERVICE_NAME, method: "getHeartbeatGeoJob" });
				}

				if (!monitor.geoCheckEnabled) {
					return;
				}
				if (!supportsGeoCheck(monitor.type)) {
					this.logger.debug({
						message: `Monitor ${monitorId} type does not support geo checks, skipping`,
						service: SERVICE_NAME,
						method: "getHeartbeatGeoJob",
					});
					return;
				}

				if (!monitor.geoCheckLocations || monitor.geoCheckLocations.length === 0) {
					this.logger.warn({
						message: `No geo check locations configured for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getHeartbeatGeoJob",
					});
					return;
				}

				// Step 2: Check for maintenance window
				const maintenanceWindowActive = await this.isInMaintenanceWindow(monitorId, teamId);
				if (maintenanceWindowActive) {
					this.logger.debug({
						message: `Monitor ${monitorId} is in maintenance window, skipping geo check`,
						service: SERVICE_NAME,
						method: "getHeartbeatGeoJob",
					});
					return;
				}

				// Step 3: Build geo check (handles API calls and polling)
				const geoCheck = await this.geoChecksService.buildGeoCheck(monitor);
				if (!geoCheck) {
					this.logger.warn({
						message: `No geo check could be built for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getHeartbeatGeoJob",
					});
					return;
				}

				// Step 4: Add geo check to buffer
				this.buffer.addGeoCheckToBuffer(geoCheck);

				this.logger.debug({
					message: `Geo check job executed for monitor ${monitorId}`,
					service: SERVICE_NAME,
					method: "getHeartbeatGeoJob",
				});
			} catch (error: unknown) {
				this.logger.error({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getHeartbeatGeoJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
				// Don't throw - geo check failures shouldn't crash the job scheduler
			}
		};
	};

	async isInMaintenanceWindow(monitorId: string, teamId: string) {
		const maintenanceWindows = await this.maintenanceWindowsRepository.findByMonitorId(monitorId, teamId);
		// Check for active maintenance window:
		const maintenanceWindowIsActive = maintenanceWindows.reduce((acc: boolean, window: MaintenanceWindow) => {
			if (window.active) {
				const start = new Date(window.start);
				const end = new Date(window.end);
				const now = new Date();
				const repeatInterval = window.repeat || 0;

				// If start is < now and end > now, we're in maintenance
				if (start <= now && end >= now) return true;

				// If maintenance window was set in the past with a repeat,
				// we need to advance start and end to see if we are in range

				while (start < now && repeatInterval !== 0) {
					start.setTime(start.getTime() + repeatInterval);
					end.setTime(end.getTime() + repeatInterval);
					if (start <= now && end >= now) {
						return true;
					}
				}
				return false;
			}
			return acc;
		}, false);
		return maintenanceWindowIsActive;
	}

	getCleanupRetentionJob = () => {
		return async () => {
			try {
				const settings = await this.settingsService.getDBSettings();

				const checkTTL = settings.checkTTL; // Check TTL is in DAYS, not MS

				if (checkTTL === CHECK_TTL_SENTINEL) {
					this.logger.info({
						message: `Check TTL is set to unlimited, skipping cleanup`,
						service: SERVICE_NAME,
						method: "getCleanupRetentionJob",
					});
					return;
				}
				const checkTTLInMs = checkTTL * 24 * 60 * 60 * 1000;
				const cutoffDate = new Date(Date.now() - checkTTLInMs);
				const deleteCount = await this.checkService.deleteOlderThan(cutoffDate);
				this.logger.info({
					message: `Deleted ${deleteCount} checks older than ${cutoffDate.toISOString()}`,
					service: SERVICE_NAME,
					method: "getCleanupRetentionJob",
				});
			} catch (error: unknown) {
				this.logger.error({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getCleanupRetentionJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		};
	};

	private evaluateMonitorAction(statusChangeResult: StatusChangeResult): MonitorActionDecision {
		const { monitor, statusChanged, prevStatus } = statusChangeResult;

		// Initialize result
		const decision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: false,
			incidentReason: null,
			notificationReason: null,
		};

		if (!statusChanged) {
			return decision;
		}

		if (monitor.status === "down") {
			// Monitor went down (unreachable)
			decision.shouldCreateIncident = true;
			decision.shouldSendNotification = true;
			decision.incidentReason = "status_down";
			decision.notificationReason = "status_change";
		} else if (monitor.status === "breached") {
			// Hardware monitor exceeded thresholds
			decision.shouldCreateIncident = true;
			decision.shouldSendNotification = true;
			decision.incidentReason = "threshold_breach";
			decision.notificationReason = "threshold_breach";
		} else if (monitor.status === "up" && (prevStatus === "down" || prevStatus === "breached")) {
			// Monitor recovered from down or breached state
			decision.shouldResolveIncident = true;
			decision.shouldSendNotification = true;
			decision.notificationReason = "status_change";
		}

		return decision;
	}
	//** ADDED METHOD TO CHECK FOR INCIDENT ESCALATION **//

	getEscalationCheckJob = () => {
		return async () => {
			try {
				this.logger.debug({
					message: "Starting escalation check",
					service: SERVICE_NAME,
					method: "getEscalationCheckJob",
				});

				// Get all active incidents
				const activeIncidents = await this.incidentsRepository.findActiveIncidents();

				this.logger.info({
					message: `Found ${activeIncidents.length} active incidents for escalation check`,
					service: SERVICE_NAME,
					method: "getEscalationCheckJob",
				});

				for (const incident of activeIncidents) {
					await this.checkIncidentEscalation(incident);
				}

				this.logger.debug({
					message: "Escalation check completed",
					service: SERVICE_NAME,
					method: "getEscalationCheckJob",
				});
			} catch (error: unknown) {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getEscalationCheckJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error;
			}
		};
	};

	private checkIncidentEscalation = async (incident: Incident) => {
		try {
			// Get the monitor for this incident
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor || !monitor.escalationSteps || monitor.escalationSteps.length === 0) {
				this.logger.debug({
					message: `Monitor ${incident.monitorId} has no escalation steps configured`,
					service: SERVICE_NAME,
					method: "checkIncidentEscalation",
				});
				return;
			}

			const now = Date.now();
			const incidentStart = new Date(incident.startTime).getTime();
			const incidentDurationMinutes = (now - incidentStart) / (1000 * 60);

			this.logger.debug({
				message: `Checking escalation for incident ${incident.id}, monitor ${monitor.id}, duration: ${incidentDurationMinutes.toFixed(2)} minutes`,
				service: SERVICE_NAME,
				method: "checkIncidentEscalation",
			});

			// Check each escalation step
			for (const step of monitor.escalationSteps) {
				if (incidentDurationMinutes >= step.delayMinutes) {
					this.logger.info({
						message: `Sending escalation for incident ${incident.id}, monitor ${monitor.id}, step delay: ${step.delayMinutes} minutes, channels: ${step.channelIds.length}`,
						service: SERVICE_NAME,
						method: "checkIncidentEscalation",
					});
					await this.sendEscalationNotification(monitor, incident, step);
				}
			}
		} catch (error: unknown) {
			this.logger.warn({
				message: `Error checking escalation for incident ${incident.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "checkIncidentEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private sendEscalationNotification = async (monitor: Monitor, incident: Incident, step: { delayMinutes: number; channelIds: string[] }) => {
		try {
			const channelIds = step.channelIds ?? [];
			if (channelIds.length === 0) {
				return;
			}

			// Build escalation message once for all channels
			const settings = this.settingsService.getSettings();
			const clientHost = settings.clientHost || "Host not defined";
			const escalationMessage = this.buildEscalationMessage(monitor, incident, step, clientHost);

			// Send to each notification channel
			for (const channelId of channelIds) {
				try {
					// Get the notification channel
					const notification = await this.notificationsRepository.findById(channelId, monitor.teamId);
					if (!notification) {
						this.logger.warn({
							message: `Escalation channel ${channelId} not found for monitor ${monitor.id}`,
							service: SERVICE_NAME,
							method: "sendEscalationNotification",
						});
						continue;
					}

					// Send the notification using the public method
					const success = await this.notificationsService.sendNotification(notification, escalationMessage);

					if (success) {
						this.logger.info({
							message: `Escalation notification sent to ${channelId} for monitor ${monitor.id}, incident ${incident.id}, delay ${step.delayMinutes} minutes`,
							service: SERVICE_NAME,
							method: "sendEscalationNotification",
						});
					} else {
						this.logger.warn({
							message: `Failed to send escalation notification to ${channelId} for monitor ${monitor.id}, incident ${incident.id}`,
							service: SERVICE_NAME,
							method: "sendEscalationNotification",
						});
					}
				} catch (channelError: unknown) {
					this.logger.warn({
						message: `Error sending escalation to channel ${channelId}: ${channelError instanceof Error ? channelError.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "sendEscalationNotification",
						stack: channelError instanceof Error ? channelError.stack : undefined,
					});
				}
			}
		} catch (error: unknown) {
			this.logger.warn({
				message: `Error sending escalation notification: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	private buildEscalationMessage = (monitor: Monitor, incident: Incident, step: { delayMinutes: number; channelIds: string[] }, clientHost: string): any => {
		// Build a proper NotificationMessage for escalation
		const message = {
			type: "monitor_down" as const,
			severity: "critical" as const,
			monitor: {
				id: monitor.id,
				name: monitor.name,
				url: monitor.url,
				type: monitor.type,
				status: monitor.status,
			},
			content: {
				title: `🚨 ESCALATION: ${monitor.name} is still down`,
				summary: `Monitor "${monitor.name}" has been down for ${step.delayMinutes} minutes. Incident started at ${incident.startTime}. Please check immediately.`,
				details: [
					`Incident ID: ${incident.id}`,
					`Monitor URL: ${monitor.url}`,
					`Escalation delay: ${step.delayMinutes} minutes`,
				],
				incident: {
					id: incident.id,
					url: `${clientHost}/incidents/${incident.id}`,
					createdAt: new Date(incident.startTime),
				},
				timestamp: new Date(),
			},
			clientHost,
			metadata: {
				teamId: monitor.teamId,
				notificationReason: "escalation",
			},
		};
		return message;
	};
	////////////////////////////////////////////////////////////////////
}
