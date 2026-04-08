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
		
		this.logger.info({
			message: "Starting test alert send",
			service: SERVICE_NAME,
			method: "sendTestAlert",
			details: { address: notification.address },
		});

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

		this.logger.info({
			message: "Built test email successfully, attempting to send",
			service: SERVICE_NAME,
			method: "sendTestAlert",
			details: { to: notification.address },
		});

		const messageId = await this.emailService.sendEmail(notification.address, subject, html);
		if (!messageId) {
			this.logger.error({
				message: "Email test alert failed - no messageId returned",
				service: SERVICE_NAME,
				method: "sendTestAlert",
				details: { to: notification.address },
			});
			return false;
		}
		
		this.logger.info({
			message: "Test alert sent successfully",
			service: SERVICE_NAME,
			method: "sendTestAlert",
			details: { messageId, to: notification.address },
		});
		
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
		return true;
	}

	private buildSubject(message: NotificationMessage): string {
		const isEscalation = message.metadata.isEscalation ? " [ESCALATION]" : "";
		switch (message.type) {
			case "monitor_down":
				return `Monitor ${message.monitor.name} is down${isEscalation}`;
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

	private async buildEmailFromMessage(message: NotificationMessage): Promise<string | undefined> {
		const context = {
			title: message.metadata.isEscalation ? `🚨 ESCALATION: ${message.content.title}` : message.content.title,
			summary: message.metadata.isEscalation ? `⚠️ **This is an escalation notification** - ${message.content.summary}` : message.content.summary,
			monitorName: message.monitor.name,
			monitorUrl: message.monitor.url,
			monitorType: message.monitor.type,
			monitorStatus: message.monitor.status,
			headerColor: this.getColorForSeverity(message.metadata.isEscalation ? "critical" : message.severity),
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
