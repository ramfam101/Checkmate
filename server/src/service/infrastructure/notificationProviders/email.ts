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
			this.logger.warn({
				message: `[ESCALATION EMAIL] No address on notification ${notification.id}`,
				service: SERVICE_NAME,
				method: "sendMessage",
			});
			return false;
		}

		this.logger.info({
			message: `[ESCALATION EMAIL] Sending to address="${notification.address}", notification=${notification.id}, type=${message.type}`,
			service: SERVICE_NAME,
			method: "sendMessage",
		});

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

		this.logger.info({
			message: `[ESCALATION EMAIL] Calling emailService.sendEmail to="${notification.address}", subject="${subject}", htmlLength=${html.length}`,
			service: SERVICE_NAME,
			method: "sendMessage",
		});

		const messageId = await this.emailService.sendEmail(notification.address, subject, html);

		this.logger.info({
			message: `[ESCALATION EMAIL] emailService.sendEmail returned messageId="${messageId}"`,
			service: SERVICE_NAME,
			method: "sendMessage",
		});

		if (!messageId) {
			this.logger.warn({
				message: "Email notification failed",
				service: SERVICE_NAME,
				method: "sendMessage",
			});
			return false;
		}
		return true;
	}

	private buildSubject(message: NotificationMessage): string {
		const prefix = message.metadata?.isEscalation ? "[ESCALATION] " : "";
		switch (message.type) {
			case "monitor_down":
				return `${prefix}Monitor ${message.monitor.name} is down`;
			case "monitor_up":
				return `${prefix}Monitor ${message.monitor.name} is back up`;
			case "threshold_breach":
				return `${prefix}Monitor ${message.monitor.name} threshold exceeded`;
			case "threshold_resolved":
				return `${prefix}Monitor ${message.monitor.name} thresholds resolved`;
			default:
				return `${prefix}Alert: ${message.monitor.name}`;
		}
	}

	private async buildEmailFromMessage(message: NotificationMessage): Promise<string | undefined> {
		const escalationLabel = message.metadata?.isEscalation ? " [ESCALATION]" : "";
		const context = {
			title: message.content.title + escalationLabel,
			summary: message.metadata?.isEscalation
				? `⚠️ ESCALATION: ${message.content.summary}`
				: message.content.summary,
			monitorName: message.monitor.name,
			monitorUrl: message.monitor.url,
			monitorType: message.monitor.type,
			monitorStatus: message.monitor.status,
			headerColor: this.getColorForSeverity(message.severity),
			thresholds: message.content.thresholds,
			details: message.content.details,
			incidentUrl: message.content.incident?.url,
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
