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
import type { NotificationMessage } from "@/types/notificationMessage.js";
import {
	IMaintenanceWindowsRepository,
	IMonitorsRepository,
	ITeamsRepository,
	IMonitorStatsRepository,
	IChecksRepository,
	IIncidentsRepository,
	IGeoChecksRepository,
	INotificationsRepository,
} from "@/repositories/index.js";
import { ILogger } from "@/utils/logger.js";
import { IBufferService } from "@/service/index.js";
import { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { Notification } from "@/types/index.js";

export interface ISuperSimpleQueueHelper {
	readonly serviceName: string;
	getHeartbeatJob(): (monitor: Monitor) => Promise<void>;
	getEscalationJob(): (monitor: Monitor) => Promise<void>;
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
	private notificationsRepository: INotificationsRepository;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private geoChecksService: IGeoChecksService;
	private geoChecksRepository: IGeoChecksRepository;
	private escalationTimeouts: Map<string, NodeJS.Timeout> = new Map();

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
		notificationsRepository: INotificationsRepository,
		notificationMessageBuilder: INotificationMessageBuilder,
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
		this.notificationsRepository = notificationsRepository;
		this.notificationMessageBuilder = notificationMessageBuilder;
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

				// Step 4.5. Schedule escalation job if monitor just went down and escalation is enabled
				if (statusChangeResult.monitor.status === "down" && statusChangeResult.prevStatus !== "down") {
					if (monitor.escalation?.delayMinutes && monitor.escalation.delayMinutes > 0) {
						const escalationDelayMs = monitor.escalation.delayMinutes * 60 * 1000;
						this.logger.debug({
							message: `Scheduling escalation job for monitor ${monitorId} in ${monitor.escalation.delayMinutes} minutes`,
							service: SERVICE_NAME,
							method: "getMonitorJob",
						});
						
						// Schedule escalation job using the queue system
						await this.scheduleEscalationJob(monitor, escalationDelayMs);
					}
				}

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

	getEscalationJob = () => {
		return async (monitor: Monitor) => {
			try {
				const monitorId = monitor.id;
				const teamId = monitor.teamId;
				if (!monitorId) {
					throw new AppError({ message: "No monitor id", service: SERVICE_NAME, method: "getEscalationJob" });
				}

				// Check if escalation is configured for this monitor
				if (!monitor.escalation?.delayMinutes || monitor.escalation.delayMinutes <= 0) {
					this.logger.debug({
						message: `Escalation not configured for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getEscalationJob",
					});
					return;
				}

				const escalationDelayMinutes = monitor.escalation.delayMinutes;

				// Check if monitor is currently down
				if (monitor.status !== "down") {
					this.logger.debug({
						message: `Monitor ${monitorId} is not down (status: ${monitor.status}), skipping escalation`,
						service: SERVICE_NAME,
						method: "getEscalationJob",
					});
					return;
				}

				// Get the latest incident to check how long it's been down
				const latestIncident = await this.incidentsRepository.findLatestByMonitorId(monitorId, teamId);
				if (!latestIncident || !latestIncident.status) { // status: true = active, false = resolved
					this.logger.debug({
						message: `No active incident found for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getEscalationJob",
					});
					return;
				}

				const incidentStartTime = new Date(latestIncident.createdAt);
				const downTimeMinutes = (Date.now() - incidentStartTime.getTime()) / (1000 * 60);
				if (downTimeMinutes < escalationDelayMinutes) {
					this.logger.debug({
						message: `Monitor ${monitorId} has been down for ${downTimeMinutes.toFixed(2)} minutes, escalation delay is ${escalationDelayMinutes} minutes`,
						service: SERVICE_NAME,
						method: "getEscalationJob",
					});
					return;
				}

				// Send escalation notifications
				this.logger.info({
					message: `Sending escalation notification for monitor ${monitorId} after ${downTimeMinutes.toFixed(2)} minutes`,
					service: SERVICE_NAME,
					method: "getEscalationJob",
				});

				// Get notifications for escalation
				const escalationChannelIds = monitor.escalation.channelIds || [];
				if (escalationChannelIds.length === 0) {
					this.logger.debug({
						message: `No escalation channels configured for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getEscalationJob",
					});
					return;
				}

				const notifications = await this.notificationsRepository.findNotificationsByIds(escalationChannelIds);
				const emailNotifications = notifications.filter(n => n.type === "email");

				if (emailNotifications.length === 0) {
					this.logger.debug({
						message: `No email escalation notifications configured for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: "getEscalationJob",
					});
					return;
				}

				// Send escalation emails
				for (const notification of emailNotifications) {
					try {
						const escalationContent = this.notificationMessageBuilder.buildEscalationContent(
							monitor,
							escalationDelayMinutes,
							latestIncident
						);

						const escalationMessage: NotificationMessage = {
							type: "escalation",
							severity: "critical",
							monitor: {
								id: monitor.id,
								name: monitor.name,
								url: monitor.url,
								type: monitor.type,
								status: monitor.status,
							},
							content: escalationContent,
							clientHost: "", // Will be set by the service
							metadata: {
								teamId: monitor.teamId,
								notificationReason: "escalation",
							},
						};

						await this.notificationsService.sendNotification(notification, escalationMessage);
						
						this.logger.debug({
							message: `Sent escalation notification to ${notification.address} for monitor ${monitorId}`,
							service: SERVICE_NAME,
							method: "getEscalationJob",
						});
					} catch (error: unknown) {
						this.logger.error({
							message: `Failed to send escalation notification to ${notification.address} for monitor ${monitorId}: ${error instanceof Error ? error.message : "Unknown error"}`,
							service: SERVICE_NAME,
							method: "getEscalationJob",
							stack: error instanceof Error ? error.stack : undefined,
						});
					}
				}

			} catch (error: unknown) {
				this.logger.warn({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "getEscalationJob",
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

	private scheduleEscalationJob = async (monitor: Monitor, delayMs: number) => {
		try {
			const escalationJobId = `escalation-${monitor.id}`;
			
			// Cancel any existing escalation timeout for this monitor
			const existingTimeout = this.escalationTimeouts.get(escalationJobId);
			if (existingTimeout) {
				clearTimeout(existingTimeout);
			}
			
			// Schedule the escalation job using setTimeout
			const timeout = setTimeout(async () => {
				try {
					// Fetch fresh monitor data to ensure we have the latest status
					const freshMonitor = await this.monitorsRepository.findById(monitor.id, monitor.teamId);
					if (freshMonitor) {
						// Execute the escalation job with fresh data
						await this.getEscalationJob()(freshMonitor);
					}
				} catch (error: unknown) {
					this.logger.error({
						message: `Error executing escalation job for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
						service: SERVICE_NAME,
						method: "scheduleEscalationJob",
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
				// Clean up the timeout from the map
				this.escalationTimeouts.delete(escalationJobId);
			}, delayMs);
			
			// Store the timeout so we can cancel it if needed
			this.escalationTimeouts.set(escalationJobId, timeout);
			
			this.logger.info({
				message: `Scheduled escalation job for monitor ${monitor.id} to execute in ${Math.round(delayMs / 1000)} seconds`,
				service: SERVICE_NAME,
				method: "scheduleEscalationJob",
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error scheduling escalation job for monitor ${monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "scheduleEscalationJob",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}
}
