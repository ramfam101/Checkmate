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
				message: "Missing address",
				service: SERVICE_NAME,
				method: "sendMessage",
			});
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
		switch (message.type) {
			case "monitor_down":
				return `Monitor ${message.monitor.name} is down`;
			case "monitor_up":
				return `Monitor ${message.monitor.name} is back up`;
			case "threshold_breach":
				return `Monitor ${message.monitor.name} threshold exceeded`;
			case "monitor_still_down":
				return `Monitor ${message.monitor.name} is still down`;
			case "threshold_resolved":
				return `Monitor ${message.monitor.name} thresholds resolved`;
			default:
				return `Alert: ${message.monitor.name}`;
		}
	}

	private async buildEmailFromMessage(message: NotificationMessage): Promise<string | undefined> {
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
		};
		const html = await this.emailService.buildEmail("unifiedNotificationTemplate", context);
		if (html) {
			return html;
		}

		this.logger.warn({
			message: "Failed to build unified notification template, falling back to basic email",
			service: SERVICE_NAME,
			method: "buildEmailFromMessage",
			details: { monitorName: message.monitor.name, type: message.type },
		});

		return this.buildFallbackEmailFromMessage(message);
	}

	private buildFallbackEmailFromMessage(message: NotificationMessage): string {
		const details = (message.content.details ?? []).map((detail) => `<li>${detail}</li>`).join("");
		const thresholdLines = (message.content.thresholds ?? [])
			.map((threshold) => `<li>${threshold.metric}: ${threshold.formattedValue} (threshold: ${threshold.threshold}${threshold.unit})</li>`)
			.join("");

		return `
			<html>
				<body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
					<h2>${message.content.title}</h2>
					<p>${message.content.summary}</p>
					<ul>
						<li><strong>Monitor:</strong> ${message.monitor.name}</li>
						<li><strong>URL:</strong> ${message.monitor.url}</li>
						<li><strong>Type:</strong> ${message.monitor.type}</li>
						<li><strong>Status:</strong> ${message.monitor.status}</li>
					</ul>
					${thresholdLines ? `<h3>Threshold Breaches</h3><ul>${thresholdLines}</ul>` : ""}
					${details ? `<h3>Additional Details</h3><ul>${details}</ul>` : ""}
				</body>
			</html>
		`;
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
