const SERVICE_NAME = "JobQueueHelper";
import type { Monitor } from "@/types/monitor.js";
import { supportsGeoCheck } from "@/types/monitor.js";
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
	isInMaintenanceWindow(monitorId: string, teamId: string): Promise<boolean>;
	getEscalationJob(): () => Promise<void>;
}

export interface MonitorActionDecision {
	shouldCreateIncident: boolean;
	shouldResolveIncident: boolean;
	shouldSendNotification: boolean;
	incidentReason: "status_down" | "threshold_breach" | null;
	notificationReason: "status_change" | "threshold_breach" | "escalation" | null;
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
	private geoChecksService: IGeoChecksService;
	private geoChecksRepository: IGeoChecksRepository;
	private escalationState: Map<string, { incidentId: string; nextEligibleAtByKey: Map<string, number> }>;

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
		this.geoChecksService = geoChecksService;
		this.geoChecksRepository = geoChecksRepository;
		this.escalationState = new Map();
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

				// Step 6/7. Handle notifications + incidents (best effort, but await completion
				// so scheduler runs for this monitor do not overlap and reorder alerts).
				const sideEffects: Promise<unknown>[] = [];
				if (decision.shouldSendNotification) {
					sideEffects.push(
						this.notificationsService.handleNotifications(statusChangeResult.monitor, status, decision).catch((error: unknown) => {
							this.logger.error({
								message: `Error sending notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
								service: SERVICE_NAME,
								method: "getMonitorJob",
								stack: error instanceof Error ? error.stack : undefined,
							});
						})
					);
				}

				sideEffects.push(
					this.incidentService.handleIncident(statusChangeResult.monitor, statusChangeResult.code, decision, status).catch((error: unknown) => {
						this.logger.warn({
							message: `Error handling incident for job ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
							service: SERVICE_NAME,
							method: "getMonitorJob",
							stack: error instanceof Error ? error.stack : undefined,
						});
					})
				);

				await Promise.all(sideEffects);
			} catch (error: unknown) {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getMonitorJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
				// Keep scheduler healthy: monitor/network/provider failures should not crash or fail the recurring job.
				return;
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
				if (!validTeamIds || validTeamIds.length === 0) {
					this.logger.warn({
						message: "No valid teams returned; skipping orphan cleanup to avoid accidental mass deletion",
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
					return;
				}
				this.logger.debug({
					message: `Found ${validTeamIds.length} valid teams`,
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
				});

				// Safety-first: never auto-delete monitors in background cleanup.
				// Monitor deletion should go through explicit user/API flows that also remove scheduler jobs.
				this.logger.info({
					message: "Skipping automatic orphan monitor deletion",
					service: SERVICE_NAME,
					method: "getCleanupOrphanedJob",
				});

				// Remove orphaned monitorStats (stats without a valid monitor)
				const allMonitorIds = await this.monitorsRepository.findAllMonitorIds();
				if (!allMonitorIds || allMonitorIds.length === 0) {
					this.logger.warn({
						message: "No valid monitors returned; skipping monitor-linked orphan cleanup",
						service: SERVICE_NAME,
						method: "getCleanupOrphanedJob",
					});
					return;
				}
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
	getEscalationJob = () => {
		return async () => {
			try {
				this.logger.debug({
					message: "Starting escalation check",
					service: SERVICE_NAME,
					method: "getEscalationJob",
				});

				const monitors = await this.monitorsRepository.findAll();
				if (!monitors) {
					return;
				}

				for (const monitor of monitors) {
					const notificationConfigs =
						(monitor.notifications ?? [])
							.filter((notification) => typeof notification !== "string")
							.filter((notification) => notification?.escalation?.channelId && notification?.channelId) ?? [];
					if (notificationConfigs.length === 0) {
						this.escalationState.delete(monitor.id);
						continue;
					}

					const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
					if (monitor.status !== "down" && monitor.status !== "breached") {
						this.escalationState.delete(monitor.id);
						continue;
					}

					if (!activeIncident) {
						this.escalationState.delete(monitor.id);
						continue;
					}

					const currentState = this.escalationState.get(monitor.id);
					const nextEligibleAtByKey = currentState?.incidentId === activeIncident.id ? currentState.nextEligibleAtByKey : new Map<string, number>();
					const incidentStartTime = Number(activeIncident.startTime) || new Date(activeIncident.startTime).getTime();
					const now = Date.now();
					const incidentDurationMinutes = (now - incidentStartTime) / 1000 / 60;

					for (const notification of notificationConfigs) {
						if (!notification.escalation) {
							continue;
						}

						const escalationKey = `${notification.channelId}:${notification.escalation.channelId}:${notification.escalation.delayMinutes}`;
						const nextEligibleAt = nextEligibleAtByKey.get(escalationKey) ?? incidentStartTime + notification.escalation.delayMinutes * 60 * 1000;
						if (incidentDurationMinutes < notification.escalation.delayMinutes || now < nextEligibleAt) {
							continue;
						}

						try {
							const sent = await this.notificationsService.handleNotifications(
								{
									...monitor,
									notifications: [{ channelId: notification.escalation.channelId }],
								},
								{
									monitorId: monitor.id,
									teamId: monitor.teamId,
									type: monitor.type,
									status: false,
									code: activeIncident.statusCode || 500,
									message: activeIncident.message || "Monitor still down",
									responseTime: 0,
								},
								{
									shouldSendNotification: true,
									notificationReason: "escalation",
									shouldCreateIncident: false,
									shouldResolveIncident: false,
									incidentReason: null,
								}
							);

							if (!sent) {
								this.logger.warn({
									message: `Escalation notification was not sent for monitor ${monitor.id}`,
									service: SERVICE_NAME,
									method: "getEscalationJob",
									details: {
										monitorChannelId: notification.channelId,
										escalationChannelId: notification.escalation.channelId,
										delayMinutes: notification.escalation.delayMinutes,
									},
								});
								continue;
							}
						} catch (error: unknown) {
							this.logger.warn({
								message: `Failed to send escalation for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
								service: SERVICE_NAME,
								method: "getEscalationJob",
								stack: error instanceof Error ? error.stack : undefined,
							});
							continue;
						}

						nextEligibleAtByKey.set(escalationKey, now + notification.escalation.delayMinutes * 60 * 1000);
					}

					this.escalationState.set(monitor.id, {
						incidentId: activeIncident.id,
						nextEligibleAtByKey,
					});
				}
			} catch (error: unknown) {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getEscalationJob",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		};
	};
}
