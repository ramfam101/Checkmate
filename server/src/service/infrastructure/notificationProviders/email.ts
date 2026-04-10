const SERVICE_NAME = "EmailProvider";
import type { Notification } from "@/types/index.js";
import { INotificationProvider } from "@/service/index.js";
import { buildTestEmail } from "@/service/infrastructure/notificationProviders/utils.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import type { ILogger } from "@/utils/logger.js";
import { IEmailService, type EmailTransportErrorDetails } from "@/service/infrastructure/emailService.js";

type NotificationProviderTestResult = {
	success: boolean;
	error?: string;
	details?: Record<string, unknown>;
};

export class EmailProvider implements INotificationProvider {
	private emailService: IEmailService;
	private logger: ILogger;

	constructor(emailService: IEmailService, logger: ILogger) {
		this.emailService = emailService;
		this.logger = logger;
	}

	private buildTransportFailureReason = (transportError: EmailTransportErrorDetails | null) => {
		if (!transportError) {
			return "SMTP send failed";
		}

		const stage = transportError.stage;
		const code = typeof transportError.code === "string" ? transportError.code : "UNKNOWN";
		const base = typeof transportError.message === "string" ? transportError.message : "Unknown transport error";

		return `SMTP ${stage} failed (${code}): ${base}`;
	};

	async sendTestAlert(notification: Partial<Notification>): Promise<boolean> {
		const result = await this.sendTestAlertWithResult(notification);
		return result.success;
	}

	async sendTestAlertWithResult(notification: Partial<Notification>): Promise<NotificationProviderTestResult> {
		const subject = "Test notification";
		const html = await buildTestEmail(this.emailService);

		if (!notification.address) {
			const details = { type: notification.type };
			this.logger.warn({
				message: "Missing address",
				service: SERVICE_NAME,
				method: "sendTestAlert",
				details,
			});
			return {
				success: false,
				error: "Missing recipient email address",
				details,
			};
		}

		if (!html) {
			const details = { type: notification.type, address: notification.address };
			this.logger.warn({
				message: "Failed to build test email content",
				service: SERVICE_NAME,
				method: "sendTestAlert",
				details,
			});
			return {
				success: false,
				error: "Failed to build email template",
				details,
			};
		}

		const messageId = await this.emailService.sendEmail(notification.address, subject, html);
		if (!messageId) {
			const transportError = this.emailService.getLastError();
			const details = {
				address: notification.address,
				transportError,
			};
			const reason = this.buildTransportFailureReason(transportError);
			this.logger.warn({
				message: "Email test alert failed",
				service: SERVICE_NAME,
				method: "sendTestAlert",
				details,
			});
			return {
				success: false,
				error: reason,
				details,
			};
		}

		return { success: true };
	}

	async sendMessage(notification: Notification, message: NotificationMessage): Promise<boolean> {
		if (!notification.address) {
			this.logger.warn({
				message: "Missing recipient email address",
				service: SERVICE_NAME,
				method: "sendMessage",
				details: { notificationId: notification.id, monitor: message.monitor.name },
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
				details: { notificationId: notification.id, monitor: message.monitor.name },
			});
			return false;
		}

		const messageId = await this.emailService.sendEmail(notification.address, subject, html);
		if (!messageId) {
			const transportError = this.emailService.getLastError();
			this.logger.warn({
				message: "Email notification failed",
				service: SERVICE_NAME,
				method: "sendMessage",
				details: {
					notificationId: notification.id,
					address: notification.address,
					transportError,
				},
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
