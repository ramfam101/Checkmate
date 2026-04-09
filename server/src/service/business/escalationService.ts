const SERVICE_NAME = "EscalationService";
import type { Monitor } from "@/types/monitor.js";
import type { Incident } from "@/types/incident.js";
import { AppError } from "@/utils/AppError.js";
import type { IIncidentsRepository, IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import type { ILogger } from "@/utils/logger.js";
import type { IEmailService } from "@/service/infrastructure/emailService.js";

export interface IEscalationService {
	startRepeatingNotifications(incident: Incident, monitor: Monitor): Promise<void>;
	executeRepeatNotification(incidentId: string, teamId: string): Promise<void>;
	stopRepeatingNotifications(incidentId: string, teamId: string): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;
	private incidentsRepository: IIncidentsRepository;
	private monitorsRepository: IMonitorsRepository;
	private notificationsRepository: INotificationsRepository;
	private emailService: IEmailService;

	constructor(
		logger: ILogger,
		incidentsRepository: IIncidentsRepository,
		monitorsRepository: IMonitorsRepository,
		notificationsRepository: INotificationsRepository,
		emailService: IEmailService
	) {
		this.logger = logger;
		this.incidentsRepository = incidentsRepository;
		this.monitorsRepository = monitorsRepository;
		this.notificationsRepository = notificationsRepository;
		this.emailService = emailService;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	/**
	 * Called when an incident STARTS
	 * - Sends the FIRST notification immediately
	 * - Schedules the next repeat notification based on user's interval
	 */
	startRepeatingNotifications = async (incident: Incident, monitor: Monitor): Promise<void> => {
		try {
			// Send initial alert through all configured notification channels
			await this.sendInitialAlert(incident, monitor);

			// Calculate next notification time based on monitor's notification interval
			const nextNotificationTime = new Date(Date.now() + monitor.notificationInterval * 60 * 1000);

			// Update incident with scheduled next notification
			await this.incidentsRepository.updateById(incident.id, incident.teamId, {
				scheduledNextNotification: nextNotificationTime.toISOString(),
				escalationHistory: [
					{
						notificationSentAt: new Date().toISOString(),
						intervalMinutes: monitor.notificationInterval,
					},
				],
			});

			// Schedule the repeat notification job
			await this.scheduleRepeatNotificationJob(incident.id, nextNotificationTime, monitor.notificationInterval, incident.teamId);

			this.logger.info({
				message: `Escalation notifications started for incident ${incident.id}`,
				service: SERVICE_NAME,
				method: "startRepeatingNotifications",
				details: {
					incidentId: incident.id,
					monitorId: monitor.id,
					nextNotificationTime: nextNotificationTime.toISOString(),
				},
			});
		} catch (error) {
			this.logger.error({
				message: `Failed to start escalation notifications: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "startRepeatingNotifications",
				details: {
					incidentId: incident.id,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Called by the job queue at scheduled intervals
	 * - Sends a REPEAT notification email
	 * - Schedules the next one
	 * - Updates escalation history
	 */
	executeRepeatNotification = async (incidentId: string, teamId: string): Promise<void> => {
		try {
			// Get the incident
			const incident = await this.incidentsRepository.findById(incidentId, teamId);
			if (!incident) {
				this.logger.warn({
					message: `Incident not found: ${incidentId}`,
					service: SERVICE_NAME,
					method: "executeRepeatNotification",
				});
				return;
			}

			// If incident is already resolved, don't send another notification
			if (!incident.status) {
				this.logger.info({
					message: `Incident ${incidentId} is already resolved, skipping repeat notification`,
					service: SERVICE_NAME,
					method: "executeRepeatNotification",
				});
				return;
			}

			// Get the monitor
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor) {
				this.logger.warn({
					message: `Monitor not found: ${incident.monitorId}`,
					service: SERVICE_NAME,
					method: "executeRepeatNotification",
				});
				return;
			}

			// Send repeat notification through all configured notification channels
			await this.sendRepeatAlert(incident, monitor);

			// Calculate next notification time
			const nextNotificationTime = new Date(Date.now() + monitor.notificationInterval * 60 * 1000);

			// Update incident with new scheduled notification time and add to history
			const updatedHistory = incident.escalationHistory || [];
			updatedHistory.push({
				notificationSentAt: new Date().toISOString(),
				intervalMinutes: monitor.notificationInterval,
			});

			// Keep only last 100 entries to prevent unbounded growth
			const trimmedHistory = updatedHistory.slice(-100);

			await this.incidentsRepository.updateById(incidentId, incident.teamId, {
				scheduledNextNotification: nextNotificationTime.toISOString(),
				escalationHistory: trimmedHistory,
			});

			// Schedule the next repeat notification job
			await this.scheduleRepeatNotificationJob(incidentId, nextNotificationTime, monitor.notificationInterval, incident.teamId);

			this.logger.info({
				message: `Repeat notification sent for incident ${incidentId}`,
				service: SERVICE_NAME,
				method: "executeRepeatNotification",
				details: {
					incidentId,
					nextNotificationTime: nextNotificationTime.toISOString(),
				},
			});
		} catch (error) {
			this.logger.error({
				message: `Failed to execute repeat notification: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "executeRepeatNotification",
				details: {
					incidentId,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Called when incident RESOLVES
	 * - Cancels any pending notifications
	 * - Sends a RECOVERY email
	 * - Clears scheduledNextNotification
	 */
	stopRepeatingNotifications = async (incidentId: string, teamId: string): Promise<void> => {
		try {
			// Get the incident
			const incident = await this.incidentsRepository.findById(incidentId, teamId);
			if (!incident) {
				this.logger.warn({
					message: `Incident not found: ${incidentId}`,
					service: SERVICE_NAME,
					method: "stopRepeatingNotifications",
				});
				return;
			}

			// Get the monitor
			const monitor = await this.monitorsRepository.findById(incident.monitorId, incident.teamId);
			if (!monitor) {
				this.logger.warn({
					message: `Monitor not found: ${incident.monitorId}`,
					service: SERVICE_NAME,
					method: "stopRepeatingNotifications",
				});
				return;
			}

			// Cancel pending scheduled job (if any)
			// Note: super-simple-scheduler doesn't have a built-in way to remove specific delayed jobs,
			// but we mark it as resolved so executeRepeatNotification will skip it

			// Send recovery notification through all configured notification channels
			await this.sendRecoveryAlert(incident, monitor);

			// Clear the scheduled notification
			await this.incidentsRepository.updateById(incidentId, incident.teamId, {
				scheduledNextNotification: null,
			});

			this.logger.info({
				message: `Escalation notifications stopped for incident ${incidentId}`,
				service: SERVICE_NAME,
				method: "stopRepeatingNotifications",
				details: {
					incidentId,
				},
			});
		} catch (error) {
			this.logger.error({
				message: `Failed to stop escalation notifications: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "stopRepeatingNotifications",
				details: {
					incidentId,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Send the initial alert through all configured notification channels
	 */
	private sendInitialAlert = async (incident: Incident, monitor: Monitor): Promise<void> => {
		// If no notifications are configured, skip
		if (!monitor.notifications || monitor.notifications.length === 0) {
			this.logger.warn({
				message: `No notification channels configured for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "sendInitialAlert",
			});
			return;
		}

		// Get all configured notifications
		try {
			const notifications = await this.notificationsRepository.findNotificationsByIds(monitor.notifications);

			for (const notification of notifications) {
				try {
					if (notification.type === "email" && notification.address) {
						const subject = `🔴 ALERT: ${monitor.name} is DOWN`;
						const durationMinutes = Math.floor((Date.now() - new Date(incident.startTime).getTime()) / 60000);

						const context = {
							monitorName: monitor.name,
							monitorUrl: monitor.url,
							status: "DOWN",
							statusCode: incident.statusCode || "N/A",
							message: incident.message || "No additional details available",
							startTime: new Date(incident.startTime).toISOString(),
							durationMinutes,
							interval: monitor.notificationInterval,
							notificationType: "initial",
						};

						const html = await this.buildEmailHTML(context);
						if (!html) {
							throw new AppError({
								message: "Failed to build email content",
								status: 500,
							});
						}

						const messageId = await this.emailService.sendEmail(notification.address, subject, html);
						if (!messageId) {
							throw new AppError({
								message: "Failed to send email notification",
								status: 500,
							});
						}

						this.logger.info({
							message: `Initial alert sent to ${notification.address}`,
							service: SERVICE_NAME,
							method: "sendInitialAlert",
							details: {
								incidentId: incident.id,
								notificationId: notification.id,
							},
						});
					}
				} catch (error) {
					this.logger.error({
						message: `Failed to send notification ${notification.id}: ${error instanceof Error ? error.message : String(error)}`,
						service: SERVICE_NAME,
						method: "sendInitialAlert",
						details: {
							notificationId: notification.id,
							incidentId: incident.id,
						},
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		} catch (error) {
			this.logger.error({
				message: `Failed to fetch notifications: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "sendInitialAlert",
				details: {
					incidentId: incident.id,
					monitorId: monitor.id,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Send a repeat/reminder alert through all configured notification channels
	 */
	private sendRepeatAlert = async (incident: Incident, monitor: Monitor): Promise<void> => {
		// If no notifications are configured, skip
		if (!monitor.notifications || monitor.notifications.length === 0) {
			this.logger.warn({
				message: `No notification channels configured for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "sendRepeatAlert",
			});
			return;
		}

		// Get all configured notifications
		try {
			const notifications = await this.notificationsRepository.findNotificationsByIds(monitor.notifications);

			for (const notification of notifications) {
				try {
					if (notification.type === "email" && notification.address) {
						const subject = `🔴 REMINDER: ${monitor.name} still DOWN`;
						const durationMinutes = Math.floor((Date.now() - new Date(incident.startTime).getTime()) / 60000);

						const context = {
							monitorName: monitor.name,
							monitorUrl: monitor.url,
							status: "DOWN",
							statusCode: incident.statusCode || "N/A",
							message: incident.message || "No additional details available",
							startTime: new Date(incident.startTime).toISOString(),
							durationMinutes,
							interval: monitor.notificationInterval,
							notificationType: "repeat",
						};

						const html = await this.buildEmailHTML(context);
						if (!html) {
							throw new AppError({
								message: "Failed to build email content",
								status: 500,
							});
						}

						const messageId = await this.emailService.sendEmail(notification.address, subject, html);
						if (!messageId) {
							throw new AppError({
								message: "Failed to send email notification",
								status: 500,
							});
						}

						this.logger.info({
							message: `Repeat alert sent to ${notification.address}`,
							service: SERVICE_NAME,
							method: "sendRepeatAlert",
							details: {
								incidentId: incident.id,
								notificationId: notification.id,
							},
						});
					}
				} catch (error) {
					this.logger.error({
						message: `Failed to send notification ${notification.id}: ${error instanceof Error ? error.message : String(error)}`,
						service: SERVICE_NAME,
						method: "sendRepeatAlert",
						details: {
							notificationId: notification.id,
							incidentId: incident.id,
						},
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		} catch (error) {
			this.logger.error({
				message: `Failed to fetch notifications: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "sendRepeatAlert",
				details: {
					incidentId: incident.id,
					monitorId: monitor.id,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Send a repeat/reminder alert through all configured notification channels
	 */
	private sendRecoveryAlert = async (incident: Incident, monitor: Monitor): Promise<void> => {
		// If no notifications are configured, skip
		if (!monitor.notifications || monitor.notifications.length === 0) {
			this.logger.warn({
				message: `No notification channels configured for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "sendRecoveryAlert",
			});
			return;
		}

		// Get all configured notifications
		try {
			const notifications = await this.notificationsRepository.findNotificationsByIds(monitor.notifications);

			for (const notification of notifications) {
				try {
					if (notification.type === "email" && notification.address) {
						const subject = `✅ RESOLVED: ${monitor.name} is back UP`;
						const endTime = incident.endTime ? new Date(incident.endTime).getTime() : Date.now();
						const startTime = new Date(incident.startTime).getTime();
						const durationMinutes = Math.floor((endTime - startTime) / 60000);

						const context = {
							monitorName: monitor.name,
							monitorUrl: monitor.url,
							status: "UP",
							statusCode: "200",
							message: "Monitor has recovered",
							startTime: new Date(incident.startTime).toISOString(),
							endTime: new Date(endTime).toISOString(),
							durationMinutes,
							interval: monitor.notificationInterval,
							notificationType: "recovery",
						};

						const html = await this.buildEmailHTML(context);
						if (!html) {
							throw new AppError({
								message: "Failed to build email content",
								status: 500,
							});
						}

						const messageId = await this.emailService.sendEmail(notification.address, subject, html);
						if (!messageId) {
							throw new AppError({
								message: "Failed to send email notification",
								status: 500,
							});
						}

						this.logger.info({
							message: `Recovery alert sent to ${notification.address}`,
							service: SERVICE_NAME,
							method: "sendRecoveryAlert",
							details: {
								incidentId: incident.id,
								notificationId: notification.id,
							},
						});
					}
				} catch (error) {
					this.logger.error({
						message: `Failed to send notification ${notification.id}: ${error instanceof Error ? error.message : String(error)}`,
						service: SERVICE_NAME,
						method: "sendRecoveryAlert",
						details: {
							notificationId: notification.id,
							incidentId: incident.id,
						},
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}
		} catch (error) {
			this.logger.error({
				message: `Failed to fetch notifications: ${error instanceof Error ? error.message : String(error)}`,
				service: SERVICE_NAME,
				method: "sendRecoveryAlert",
				details: {
					incidentId: incident.id,
					monitorId: monitor.id,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Build HTML email content. This is a simple implementation;
	 * you can enhance it to use email templates or MJML.
	 */
	private buildEmailHTML = async (context: Record<string, unknown>): Promise<string> => {
		// Simple HTML template - can be replaced with MJML or HTML templates
		const { monitorName, status, durationMinutes, notificationType } = context;

		let title = "";
		let color = "";

		if (notificationType === "initial") {
			title = `🔴 Alert: ${monitorName} is DOWN`;
			color = "#dc2626";
		} else if (notificationType === "repeat") {
			title = `🔴 Reminder: ${monitorName} still DOWN (${durationMinutes} minutes)`;
			color = "#ea580c";
		} else if (notificationType === "recovery") {
			title = `✅ Resolved: ${monitorName} is back UP`;
			color = "#16a34a";
		}

		return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<style>
				body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.header { background-color: ${color}; color: white; padding: 20px; border-radius: 5px; }
				.content { background-color: #f3f4f6; padding: 20px; margin: 20px 0; border-radius: 5px; }
				.footer { color: #6b7280; font-size: 12px; text-align: center; margin-top: 20px; }
				.info-row { margin: 10px 0; }
				.label { font-weight: bold; color: #1f2937; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<h1>${title}</h1>
				</div>
				<div class="content">
					<div class="info-row">
						<span class="label">Monitor:</span> ${monitorName}
					</div>
					<div class="info-row">
						<span class="label">Status:</span> ${status}
					</div>
					<div class="info-row">
						<span class="label">Duration:</span> ${durationMinutes} minutes
					</div>
					<div class="info-row">
						<span class="label">URL:</span> ${context.monitorUrl}
					</div>
				</div>
				<div class="footer">
					<p>This is an automated notification from Checkmate Monitoring System</p>
				</div>
			</div>
		</body>
		</html>
		`;
	};

	/**
	 * Schedule a repeat notification job in the queue
	 * Note: super-simple-scheduler runs in-memory, so scheduled jobs are lost on restart
	 */
	private scheduleRepeatNotificationJob = async (incidentId: string, scheduledTime: Date, delayMinutes: number, teamId: string): Promise<void> => {
		// Calculate delay in milliseconds
		const delayMs = Math.max(0, scheduledTime.getTime() - Date.now());

		// Schedule a job that will execute after the delay
		// Note: This is a simplified implementation since super-simple-scheduler
		// is in-memory. For production, you might want to enhance this with
		// persistence or use a proper job queue like BullMQ.

		setTimeout(async () => {
			await this.executeRepeatNotification(incidentId, teamId);
		}, delayMs);

		this.logger.debug({
			message: `Scheduled repeat notification job for incident ${incidentId}`,
			service: SERVICE_NAME,
			method: "scheduleRepeatNotificationJob",
			details: {
				incidentId,
				delayMinutes,
				scheduledTime: scheduledTime.toISOString(),
			},
		});
	};
}
