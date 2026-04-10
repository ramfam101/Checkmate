import type { Monitor } from "@/types/monitor.js";
import type { MonitorStatusResponse } from "@/types/index.js";
import type { IMonitorsRepository, INotificationsRepository } from "@/repositories/index.js";
import type { ILogger } from "@/utils/logger.js";
import type { IEmailService } from "@/service/infrastructure/emailService.js";

export interface IEscalationService {
	checkAndHandleEscalation(
		monitor: Monitor,
		decision: any,
		monitorStatusResponse: MonitorStatusResponse
	): Promise<void>;
	resetEscalationOnRecovery(monitorId: string, teamId: string): Promise<void>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private monitorsRepository: IMonitorsRepository;
	private notificationsRepository: INotificationsRepository;
	private emailService: IEmailService;
	private logger: ILogger;

	constructor(
		monitorsRepository: IMonitorsRepository,
		notificationsRepository: INotificationsRepository,
		emailService: IEmailService,
		logger: ILogger
	) {
		this.monitorsRepository = monitorsRepository;
		this.notificationsRepository = notificationsRepository;
		this.emailService = emailService;
		this.logger = logger;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	/**
	 * Check if escalation should trigger and send escalation notifications
	 */
	checkAndHandleEscalation = async (
		monitor: Monitor,
		decision: any,
		monitorStatusResponse: MonitorStatusResponse
	): Promise<void> => {
		// Only escalate if monitor is down and escalation is configured
		if (!monitor.escalationMinutes || (monitor.escalationNotificationIds?.length ?? 0) === 0) {
			return;
		}

		// Already escalated, don't escalate again
		if (monitor.hasEscalated) {
			return;
		}

		const now = new Date();
		const lastFailureTime = monitor.lastFailureTime ? new Date(monitor.lastFailureTime) : now;
		const timeSinceFailureMs = now.getTime() - lastFailureTime.getTime();
		const escalationTimeMs = monitor.escalationMinutes * 60 * 1000;

		// Check if we've passed the escalation threshold
		if (timeSinceFailureMs >= escalationTimeMs) {
			await this.sendEscalationNotification(monitor);

			// Mark as escalated
			await this.monitorsRepository.updateById(monitor.id, monitor.teamId, {
				hasEscalated: true,
			});

			this.logger.info({
				message: `Escalation triggered for monitor ${monitor.name} (${monitor.id}) after ${monitor.escalationMinutes} minutes`,
				service: SERVICE_NAME,
				method: "checkAndHandleEscalation",
				details: { monitorId: monitor.id, escalationMinutes: monitor.escalationMinutes },
			});
		}
	};

	/**
	 * Reset escalation flag and send recovery notification when monitor comes back up
	 */
	resetEscalationOnRecovery = async (monitorId: string, teamId: string): Promise<void> => {
		const monitor = await this.monitorsRepository.findById(monitorId, teamId);

		if (!monitor) {
			return;
		}

		// If monitor had escalated, send recovery notification to escalation channels
		if (monitor.hasEscalated && (monitor.escalationNotificationIds?.length ?? 0) > 0) {
			await this.sendRecoveryNotification(monitor);
		}

		// Reset escalation flags
		await this.monitorsRepository.updateById(monitorId, teamId, {
			hasEscalated: false,
			lastFailureTime: undefined,
		});

		this.logger.info({
			message: `Escalation reset for monitor ${monitor.name} (${monitorId}) after recovery`,
			service: SERVICE_NAME,
			method: "resetEscalationOnRecovery",
			details: { monitorId },
		});
	};

	/**
	 * Send escalation notification to escalation channels via email
	 */
	private sendEscalationNotification = async (monitor: Monitor): Promise<void> => {
		try {
			const escalationChannelIds = monitor.escalationNotificationIds ?? [];

			if (escalationChannelIds.length === 0) {
				return;
			}

			for (const channelId of escalationChannelIds) {
				try {
					const notification = await this.notificationsRepository.findById(channelId, monitor.teamId);

					if (!notification) {
						this.logger.warn({
							message: `Escalation notification channel ${channelId} not found`,
							service: SERVICE_NAME,
							method: "sendEscalationNotification",
						});
						continue;
					}

					if (notification.type === "email" && notification.address) {
						const subject = `Escalation: Monitor ${monitor.name} still down`;
						const html = await this.emailService.buildEmail("unifiedNotificationTemplate", {
							title: `Escalation Alert: ${monitor.name}`,
							summary: `Monitor "${monitor.name}" has been down for ${monitor.escalationMinutes} minutes. Please investigate immediately.`,
							monitorName: monitor.name,
							monitorUrl: monitor.url,
							monitorType: monitor.type,
							monitorStatus: "down",
							headerColor: "red",
							details: [`URL: ${monitor.url}`, `Down for: ${monitor.escalationMinutes} minutes`, `Please investigate immediately.`],
						});

						if (html) {
							await this.emailService.sendEmail(notification.address, subject, html);
							this.logger.info({
								message: `Sent escalation email to ${notification.address} for monitor ${monitor.id}`,
								service: SERVICE_NAME,
								method: "sendEscalationNotification",
							});
						}
					}
				} catch (error) {
					this.logger.error({
						message: `Failed to send escalation notification to channel ${channelId}`,
						service: SERVICE_NAME,
						method: "sendEscalationNotification",
						details: { error: error instanceof Error ? error.message : String(error) },
					});
				}
			}
		} catch (error) {
			this.logger.error({
				message: `Error sending escalation notifications for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "sendEscalationNotification",
				details: { error: error instanceof Error ? error.message : String(error) },
			});
		}
	};

	/**
	 * Send recovery notification to escalation channels via email
	 */
	private sendRecoveryNotification = async (monitor: Monitor): Promise<void> => {
		try {
			const escalationChannelIds = monitor.escalationNotificationIds ?? [];

			if (escalationChannelIds.length === 0) {
				return;
			}

			for (const channelId of escalationChannelIds) {
				try {
					const notification = await this.notificationsRepository.findById(channelId, monitor.teamId);

					if (!notification) {
						continue;
					}

					if (notification.type === "email" && notification.address) {
						const subject = `Resolved: Monitor ${monitor.name} is back online`;
						const html = await this.emailService.buildEmail("unifiedNotificationTemplate", {
							title: `Monitor Recovered: ${monitor.name}`,
							summary: `Monitor "${monitor.name}" has recovered and is now responding normally.`,
							monitorName: monitor.name,
							monitorUrl: monitor.url,
							monitorType: monitor.type,
							monitorStatus: "up",
							headerColor: "green",
							details: [`URL: ${monitor.url}`, `Status: Back online`],
						});

						if (html) {
							await this.emailService.sendEmail(notification.address, subject, html);
							this.logger.info({
								message: `Sent escalation recovery email to ${notification.address} for monitor ${monitor.id}`,
								service: SERVICE_NAME,
								method: "sendRecoveryNotification",
							});
						}
					}
				} catch (error) {
					this.logger.error({
						message: `Failed to send recovery notification to channel ${channelId}`,
						service: SERVICE_NAME,
						method: "sendRecoveryNotification",
						details: { error: error instanceof Error ? error.message : String(error) },
					});
				}
			}
		} catch (error) {
			this.logger.error({
				message: `Error sending recovery notifications for monitor ${monitor.id}`,
				service: SERVICE_NAME,
				method: "sendRecoveryNotification",
				details: { error: error instanceof Error ? error.message : String(error) },
			});
		}
	};
}
