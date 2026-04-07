const SERVICE_NAME = "EmailProvider";
import type { Notification } from "@/types/index.js";
import { INotificationProvider } from "@/service/index.js";
import { buildTestEmail } from "@/service/infrastructure/notificationProviders/utils.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import type { ILogger } from "@/utils/logger.js";
import { IEmailService } from "@/service/infrastructure/emailService.js";
export class EmailProvider implements INotificationProvider {
	private emailService: IEmailService;
	private logger: ILogger;
	private escalationTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	constructor(emailService: IEmailService, logger: ILogger) {
		this.emailService = emailService;
		this.logger = logger;
	}

	async sendTestAlert(notification: Partial<Notification>): Promise<boolean> {
		const subject = "Test notification";
		const html = await buildTestEmail(this.emailService);

		if (!notification.address) {
			this.logger.warn({
				message: "Missing address",
				service: SERVICE_NAME,
				method: "sendTestAlert",
			});
			return false;
		}

		if (!html) {
			this.logger.warn({
				message: "Failed to build test email content",
				service: SERVICE_NAME,
				method: "sendTestAlert",
			});
			return false;
		}

		const messageId = await this.emailService.sendEmail(notification.address, subject, html);
		if (!messageId) {
			this.logger.warn({
				message: "Email test alert failed",
				service: SERVICE_NAME,
				method: "sendTestAlert",
			});
			return false;
		}
		return true;
	}

	async sendMessage(notification: Notification, message: NotificationMessage): Promise<boolean> {
		if (!notification.address) {
			return false;
		}

		const subject = this.buildSubject(message);
		const html = await this.buildEmailFromMessage(message);

		if (!html) {
			this.logger.warn({
				message: "Failed to build email content",
				service: SERVICE_NAME,
				method: "sendMessage",
			});
			return false;
		}

		const messageId = await this.emailService.sendEmail(notification.address, subject, html);

		if (!messageId) {
			this.logger.warn({
				message: "Email notification failed",
				service: SERVICE_NAME,
				method: "sendMessage",
			});
			return false;
		}

		const isMonitorDown = message.type === "monitor_down";
		const isRecovery = message.type === "monitor_up" || message.type === "threshold_resolved";

		if (isRecovery) {
			this.clearEscalationTimer(notification.id, message.monitor.id);
			return true;
		}

		if (
			isMonitorDown &&
			notification.escalation?.enabled &&
			Array.isArray(notification.escalation.levels) &&
			notification.escalation.levels.length > 0
		) {
			this.clearEscalationTimer(notification.id, message.monitor.id);
			const [level] = notification.escalation.levels;
			if (level.address) {
				this.scheduleEscalation(notification, message, level);
			}
		}

		return true;
	}

	private getEscalationKey(notificationId: string, monitorId: string): string {
		return `${notificationId}:${monitorId}`;
	}

	private clearEscalationTimer(notificationId: string, monitorId: string): void {
		const key = this.getEscalationKey(notificationId, monitorId);
		const timer = this.escalationTimers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.escalationTimers.delete(key);
		}
	}

	private scheduleEscalation(
		notification: Notification,
		message: NotificationMessage,
		level: NonNullable<Notification["escalation"]>["levels"][0]
	): void {
		const delayMs = (level.delayMinutes ?? 0) * 60_000;
		const key = this.getEscalationKey(notification.id, message.monitor.id);

		const timer = setTimeout(async () => {
			this.escalationTimers.delete(key);

			const escalationSubject = this.buildEscalationSubject(message, 1);
			const escalationHtml = await this.buildEmailFromMessage(message, 1);

			if (!escalationHtml) {
				this.logger.warn({
					message: "Failed to build escalation email content",
					service: SERVICE_NAME,
					method: "scheduleEscalation",
				});
				return;
			}

			const escalationMessageId = await this.emailService.sendEmail(level.address, escalationSubject, escalationHtml);
			if (!escalationMessageId) {
				this.logger.warn({
					message: "Escalation email failed",
					service: SERVICE_NAME,
					method: "scheduleEscalation",
				});
			}
		}, delayMs);

		this.escalationTimers.set(key, timer);
	}

	private buildEscalationSubject(message: NotificationMessage, level: number): string {
		return `Escalation Level ${level}: ${this.buildSubject(message)}`;
	}

	private buildSubject(message: NotificationMessage): string {
		switch (message.type) {
			case "monitor_down":
				return `Monitor ${message.monitor.name} is down`;
			case "monitor_up":
				return `Monitor ${message.monitor.name} is back up`;
			case "threshold_breach":
				return `Monitor ${message.monitor.name} threshold exceeded`;
			case "threshold_resolved":
				return `Monitor ${message.monitor.name} thresholds resolved`;
			default:
				return `Alert: ${message.monitor.name}`;
		}
	}

	private async buildEmailFromMessage(message: NotificationMessage, escalationLevel?: number): Promise<string | undefined> {
		const context = {
			title: message.content.title,
			summary: message.content.summary,
			monitorName: message.monitor.name,
			monitorUrl: message.monitor.url,
			monitorType: message.monitor.type,
			monitorStatus: message.monitor.status,
			headerColor: this.getColorForSeverity(message.severity),
			thresholds: message.content.thresholds,
			details: message.content.details,
			incidentUrl: message.content.incident?.url,
			escalationLevel: escalationLevel,
		};

		this.logger.info({
			message: "[DEBUG] Building email from message",
			service: SERVICE_NAME,
			method: "buildEmailFromMessage",
			details: { context },
		});

		const html = await this.emailService.buildEmail("unifiedNotificationTemplate", context);

		return html;
	}

	private getColorForSeverity(severity: string): string {
		const colorMap: Record<string, string> = {
			critical: "red",
			warning: "#f59e0b",
			info: "#3b82f6",
			success: "green",
		};
		return colorMap[severity] ?? "#3b82f6";
	}
}
