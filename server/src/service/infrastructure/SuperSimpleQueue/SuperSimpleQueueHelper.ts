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

	// Track last escalation send timestamp per monitor (ms since epoch)
	private lastEscalationSentAt: Map<string, number> = new Map();

	// Track last regular down notification send timestamp per monitor (ms since epoch)
	private lastRegularSentAt: Map<string, number> = new Map();

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

				// Special-case: if remote returned HTTP 503, notify immediately (useful for upstream Service Unavailable)
				try {
					if (typeof status.code !== "undefined" && Number(status.code) === 503 && monitor.status !== "down") {
						this.logger.info({
							message: `Immediate notification trigger for monitor ${monitor.id} due to HTTP 503 response`,
							service: SERVICE_NAME,
							method: "getMonitorJob",
							details: { monitorId: monitor.id, code: status.code },
						});

						const immediateDecision: MonitorActionDecision = {
							shouldCreateIncident: false,
							shouldResolveIncident: false,
							shouldSendNotification: true,
							incidentReason: "status_down",
							notificationReason: "status_change",
						};

						// Fire notification path (best-effort, don't block heartbeat)
						// Use a cloned monitor object with status forced to 'down' so notification content reflects the outage
						const monitorForNotification = { ...monitor, status: "down" } as unknown as typeof monitor;
						this.notificationsService
							.handleNotifications(monitorForNotification, status as any, immediateDecision)
							.then(() => {
								this.lastRegularSentAt.set(monitorForNotification.id, Date.now());
							})
							.catch((error: unknown) => {
								this.logger.error({
									message: `Error sending immediate 503 notification for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
									service: SERVICE_NAME,
									method: "getMonitorJob",
									stack: error instanceof Error ? error.stack : undefined,
								});
							});
					}
				} catch (error: unknown) {
					this.logger.warn({
						message: error instanceof Error ? error.message : "Unknown error",
						service: SERVICE_NAME,
						method: "getMonitorJob",
						stack: error instanceof Error ? error.stack : undefined,
					});
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

				// Compute incident start time once (used by delayed regular notifications and escalation timing)
				let incidentStartTime: number | null = null;
				try {
					const activeIncident = await this.incidentsRepository.findActiveByMonitorId(
						statusChangeResult.monitor.id,
						statusChangeResult.monitor.teamId
					);
					if (activeIncident && activeIncident.startTime) {
						incidentStartTime = new Date(activeIncident.startTime).getTime();
					} else {
						incidentStartTime = check?.createdAt ? new Date(check.createdAt).getTime() : Date.now();
					}
				} catch (err) {
					this.logger.debug({
						message: "Failed to determine incident start time, using now as fallback",
						service: SERVICE_NAME,
						method: "getMonitorJob",
					});
					incidentStartTime = Date.now();
				}

				// Step 6. Handle notifications (best effort, continue even in event of failure, don't wait)
				if (decision.shouldSendNotification) {
					// If monitor is down and has escalations configured, delay sending the regular down notification
					// until the earliest escalation minutes configured by the user. This ensures the "regular" down
					// message is sent at the time the user specified in the escalation entries.
					if (
						statusChangeResult.monitor.status === "down" &&
						Array.isArray(statusChangeResult.monitor.escalations) &&
						statusChangeResult.monitor.escalations.length > 0
					) {
						try {
							const now = Date.now();
							const elapsed = now - (incidentStartTime ?? now);
							// Find the earliest configured escalation minutes (in minutes)
							const escalationConfigs = (statusChangeResult.monitor.escalations ?? []) as Array<{ minutes?: number; notificationId?: string }>;
							const earliestMinutes = escalationConfigs.reduce((acc, e) => {
								const m = typeof e.minutes === "number" && !isNaN(e.minutes) ? e.minutes : Infinity;
								return Math.min(acc, m);
							}, Infinity);
							if (earliestMinutes !== Infinity) {
								const earliestMs = earliestMinutes * 60 * 1000;
								if (elapsed >= earliestMs) {
									// Time reached: send the normal down notification now
									this.notificationsService
										.handleNotifications(statusChangeResult.monitor, status, decision)
										.then(() => {
											this.lastRegularSentAt.set(statusChangeResult.monitor.id, Date.now());
										})
										.catch((error: unknown) => {
											this.logger.error({
												message: `Error sending regular down notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
												service: SERVICE_NAME,
												method: "getMonitorJob",
												stack: error instanceof Error ? error.stack : undefined,
											});
										});
								} else {
									this.logger.info({
										message: `Delaying regular down notification for monitor ${statusChangeResult.monitor.id} until ${earliestMinutes} minute(s) have elapsed`,
										service: SERVICE_NAME,
										method: "getMonitorJob",
									});
								}
							} else {
								// No numeric minutes found in escalation configs — fallback to immediate send
								this.notificationsService
									.handleNotifications(statusChangeResult.monitor, status, decision)
									.then(() => {
										this.lastRegularSentAt.set(statusChangeResult.monitor.id, Date.now());
									})
									.catch((error: unknown) => {
										this.logger.error({
											message: `Error sending notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
											service: SERVICE_NAME,
											method: "getMonitorJob",
											stack: error instanceof Error ? error.stack : undefined,
										});
									});
							}
						} catch (err) {
							this.logger.warn({
								message: "Error while evaluating escalation timing for regular notifications",
								service: SERVICE_NAME,
								method: "getMonitorJob",
							});
						}
					} else {
						// No escalations configured — send as before
						this.notificationsService
							.handleNotifications(statusChangeResult.monitor, status, decision)
							.then(() => {
								this.lastRegularSentAt.set(statusChangeResult.monitor.id, Date.now());
							})
							.catch((error: unknown) => {
								this.logger.error({
									message: `Error sending notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
									service: SERVICE_NAME,
									method: "getMonitorJob",
									stack: error instanceof Error ? error.stack : undefined,
								});
							});
					}
				}

				// Periodic regular down notifications: send regular down emails every 1 minute while monitor remains down
				try {
					const REGULAR_NOTIFICATION_INTERVAL_MS = 1 * 60 * 1000; // 1 minute
					if (statusChangeResult.monitor.status === "down") {
						const lastRegular = this.lastRegularSentAt.get(statusChangeResult.monitor.id) ?? 0;
						if (lastRegular > 0 && Date.now() - lastRegular >= REGULAR_NOTIFICATION_INTERVAL_MS) {
							this.notificationsService
								.handleNotifications(statusChangeResult.monitor, status, decision)
								.then(() => {
									this.lastRegularSentAt.set(statusChangeResult.monitor.id, Date.now());
								})
								.catch((err: unknown) => {
									this.logger.warn({
										message: `Periodic regular notification failed for monitor ${statusChangeResult.monitor.id}`,
										service: SERVICE_NAME,
										method: "getMonitorJob",
										stack: err instanceof Error ? err.stack : undefined,
									});
								});
						}
					} else {
						// monitor recovered — clear tracker
						this.lastRegularSentAt.delete(statusChangeResult.monitor.id);
					}
				} catch (err: unknown) {
					this.logger.warn({
						message: `Error in periodic regular notification logic: ${err instanceof Error ? err.message : "Unknown"}`,
						service: SERVICE_NAME,
						method: "getMonitorJob",
					});
				}

				// Escalation logic: if monitor is down, send escalation emails every 3 minutes while incident active
				try {
					const MONITOR_ESCALATION_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
					if (statusChangeResult.monitor.status === "down") {
						// Prefer the active incident start time if available
						const activeIncident = await this.incidentsRepository.findActiveByMonitorId(
							statusChangeResult.monitor.id,
							statusChangeResult.monitor.teamId
						);
						let incidentStartTime: number | null = null;
						if (activeIncident && activeIncident.startTime) {
							incidentStartTime = new Date(activeIncident.startTime).getTime();
						} else {
							// fallback to the check timestamp (time of this failure detection)
							incidentStartTime = check?.createdAt ? new Date(check.createdAt).getTime() : Date.now();
						}

						const now = Date.now();
						const elapsed = now - (incidentStartTime ?? now);
						if (elapsed >= MONITOR_ESCALATION_INTERVAL_MS) {
							const lastSent = this.lastEscalationSentAt.get(statusChangeResult.monitor.id) ?? 0;
							if (now - lastSent >= MONITOR_ESCALATION_INTERVAL_MS) {
								// Evaluate which escalation configs have reached their configured minutes threshold
								const escalationConfigs = (statusChangeResult.monitor.escalations ?? []) as Array<{ minutes?: number; notificationId?: string }>;
								let notificationIds: string[] = [];
								if (escalationConfigs.length > 0) {
									const eligible = escalationConfigs.filter((e) => {
										const mins = typeof e.minutes === "number" && !isNaN(e.minutes) ? e.minutes : 0;
										return elapsed >= mins * 60 * 1000;
									});
									notificationIds = eligible.map((e) => e.notificationId).filter(Boolean) as string[];
								} else {
									// If no escalation configs are present, fallback to monitor.notifications
									notificationIds = statusChangeResult.monitor.notifications ?? [];
								}
								if (notificationIds.length > 0) {
									this.logger.info({
										message: `Sending escalation notifications for monitor ${statusChangeResult.monitor.id}`,
										service: SERVICE_NAME,
										method: "getMonitorJob",
										details: { eligibleCount: notificationIds.length },
									});
									this.notificationsService
										.sendEscalationNotifications(notificationIds, { ...statusChangeResult.monitor, status: "down" } as any)
										.then((ok) => {
											if (ok) {
												this.lastEscalationSentAt.set(statusChangeResult.monitor.id, Date.now());
											}
										})
										.catch((err) => {
											this.logger.warn({
												message: `Escalation send failed for monitor ${statusChangeResult.monitor.id}`,
												service: SERVICE_NAME,
												method: "getMonitorJob",
												stack: err instanceof Error ? err.stack : undefined,
											});
										});
								}

								// Also, if escalation targets exist but regular notifications are expected, ensure periodic regular sends start
								// (we rely on lastRegularSentAt being set when a prior send occurred). If no prior regular send, do not force one here.
							}
						}
					}
				} catch (escErr: unknown) {
					this.logger.warn({
						message: escErr instanceof Error ? escErr.message : "Unknown error in escalation logic",
						service: SERVICE_NAME,
						method: "getMonitorJob",
						stack: escErr instanceof Error ? escErr.stack : undefined,
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
}
