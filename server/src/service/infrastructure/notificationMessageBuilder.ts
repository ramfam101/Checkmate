import type { HardwareStatusPayload, Monitor, MonitorStatusResponse } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type {
	NotificationMessage,
	NotificationType,
	NotificationSeverity,
	ThresholdBreach,
	NotificationContent,
} from "@/types/notificationMessage.js";

export interface INotificationMessageBuilder {
	buildMessage(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		clientHost: string
	): NotificationMessage;
	buildEscalationMessage(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		incident: { id: string; startTime: string },
		clientHost: string,
		escalationMinutes: number,
		elapsedMinutes: number
	): NotificationMessage;
	extractThresholdBreaches(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): ThresholdBreach[];
}

const SERVICE_NAME = "NotificationMessageBuilder";

export class NotificationMessageBuilder implements INotificationMessageBuilder {
	static readonly SERVICE_NAME = SERVICE_NAME;

	buildMessage(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		clientHost: string
	): NotificationMessage {
		const type = this.determineNotificationType(decision, monitor);
		const severity = this.determineSeverity(type);
		const content = this.buildContent(type, monitor, monitorStatusResponse);

		return {
			type,
			severity,
			monitor: {
				id: monitor.id,
				name: monitor.name,
				url: monitor.url,
				type: monitor.type,
				status: monitor.status,
			},
			content,
			clientHost,
			metadata: {
				teamId: monitor.teamId,
				notificationReason: decision.notificationReason || "status_change",
			},
		};
	}

	buildEscalationMessage = (
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		incident: { id: string; startTime: string },
		clientHost: string,
		escalationMinutes: number,
		elapsedMinutes: number
	): NotificationMessage => {
		const type = this.determineNotificationType({ notificationReason: "status_change" } as MonitorActionDecision, monitor);
		const severity = this.determineSeverity(type);
		const duration = this.formatDuration(elapsedMinutes);
		const thresholdLabel = this.formatDuration(escalationMinutes);

		return {
			type,
			severity,
			monitor: {
				id: monitor.id,
				name: monitor.name,
				url: monitor.url,
				type: monitor.type,
				status: monitor.status,
			},
			content: {
				title: `Escalation: ${monitor.name}`,
				summary: `Incident has been active for ${duration}. Escalation threshold ${thresholdLabel} reached.`,
				details: [
					`URL: ${monitor.url}`,
					`Status: ${monitor.status}`,
					`Type: ${monitor.type}`,
					`Incident age: ${duration}`,
					`Escalation threshold: ${thresholdLabel}`,
					...(monitorStatusResponse.code ? [`Response Code: ${monitorStatusResponse.code}`] : []),
					...(monitorStatusResponse.message ? [`Error: ${monitorStatusResponse.message}`] : []),
				],
				incident: {
					id: incident.id,
					url: `${clientHost}/incidents/${incident.id}`,
					createdAt: new Date(incident.startTime),
					duration,
				},
				timestamp: new Date(),
			},
			clientHost,
			metadata: {
				teamId: monitor.teamId,
				notificationReason: "escalation",
			},
		};
	};

	private determineNotificationType(decision: MonitorActionDecision, monitor: Monitor): NotificationType {
		// Down status has highest priority (critical)
		if (monitor.status === "down") {
			return "monitor_down";
		}

		// Threshold breach (only if not down)
		if (decision.notificationReason === "threshold_breach") {
			return "threshold_breach";
		}

		// Recovery from threshold breach (only for hardware monitors)
		if (decision.notificationReason === "status_change" && monitor.status === "up" && monitor.type === "hardware") {
			return "threshold_resolved";
		}

		// Standard recovery (up)
		if (monitor.status === "up") {
			return "monitor_up";
		}

		// Default to monitor_up for any other case
		return "monitor_up";
	}

	private determineSeverity(type: NotificationType): NotificationSeverity {
		switch (type) {
			case "monitor_down":
				return "critical";
			case "threshold_breach":
				return "warning";
			case "monitor_up":
			case "threshold_resolved":
				return "success";
			case "test":
				return "info";
			default:
				return "info";
		}
	}

	private buildContent(type: NotificationType, monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): NotificationContent {
		switch (type) {
			case "monitor_down":
				return this.buildMonitorDownContent(monitor, monitorStatusResponse);
			case "monitor_up":
				return this.buildMonitorUpContent(monitor);
			case "threshold_breach":
				return this.buildThresholdBreachContent(monitor, monitorStatusResponse as MonitorStatusResponse<HardwareStatusPayload>);
			case "threshold_resolved":
				return this.buildThresholdResolvedContent(monitor);
			default:
				return this.buildDefaultContent(monitor);
		}
	}

	private buildMonitorDownContent(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): NotificationContent {
		const title = `Monitor Down: ${monitor.name}`;
		const summary = `Monitor "${monitor.name}" is currently down and unreachable.`;
		const details = [`URL: ${monitor.url}`, `Status: Down`, `Type: ${monitor.type}`];

		// Add response code if available
		if (monitorStatusResponse.code) {
			details.push(`Response Code: ${monitorStatusResponse.code}`);
		}

		// Add error message if available
		if (monitorStatusResponse.message) {
			details.push(`Error: ${monitorStatusResponse.message}`);
		}

		return {
			title,
			summary,
			details,
			timestamp: new Date(),
		};
	}

	private buildMonitorUpContent(monitor: Monitor): NotificationContent {
		const title = `Monitor Recovered: ${monitor.name}`;
		const summary = `Monitor "${monitor.name}" is back up and operational.`;
		const details = [`URL: ${monitor.url}`, `Status: Up`, `Type: ${monitor.type}`];

		return {
			title,
			summary,
			details,
			timestamp: new Date(),
		};
	}

	private buildThresholdBreachContent(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse<HardwareStatusPayload>): NotificationContent {
		const title = `Threshold Exceeded: ${monitor.name}`;
		const summary = `Monitor "${monitor.name}" has exceeded one or more thresholds.`;
		const details = [`URL: ${monitor.url}`, `Status: Threshold exceeded`, `Type: ${monitor.type}`];

		const thresholds = this.extractThresholdBreaches(monitor, monitorStatusResponse);

		return {
			title,
			summary,
			details,
			thresholds,
			timestamp: new Date(),
		};
	}

	private buildThresholdResolvedContent(monitor: Monitor): NotificationContent {
		const title = `Thresholds Resolved: ${monitor.name}`;
		const summary = `Monitor "${monitor.name}" thresholds have returned to normal.`;
		const details = [`URL: ${monitor.url}`, `Status: Up`, `Type: ${monitor.type}`];

		return {
			title,
			summary,
			details,
			timestamp: new Date(),
		};
	}

	private buildDefaultContent(monitor: Monitor): NotificationContent {
		return {
			title: `Monitor: ${monitor.name}`,
			summary: `Status update for monitor "${monitor.name}".`,
			details: [`URL: ${monitor.url}`, `Status: ${monitor.status}`, `Type: ${monitor.type}`],
			timestamp: new Date(),
		};
	}

	private formatDuration(totalMinutes: number): string {
		const safeMinutes = Math.max(0, Math.floor(totalMinutes));
		const days = Math.floor(safeMinutes / (60 * 24));
		const hours = Math.floor((safeMinutes % (60 * 24)) / 60);
		const minutes = safeMinutes % 60;
		const parts: string[] = [];
		if (days > 0) parts.push(`${days}d`);
		if (hours > 0) parts.push(`${hours}h`);
		if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
		return parts.join(" ");
	}

	public extractThresholdBreaches(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse<HardwareStatusPayload>): ThresholdBreach[] {
		if (monitor.type !== "hardware" || !monitorStatusResponse.payload?.data) {
			return [];
		}

		const hardware = monitorStatusResponse.payload.data;
		const breaches: Array<ThresholdBreach | null> = [
			this.getCpuBreach(monitor, hardware),
			this.getMemoryBreach(monitor, hardware),
			this.getDiskBreach(monitor, hardware),
			this.getTempBreach(monitor, hardware),
		];

		return breaches.filter((breach): breach is ThresholdBreach => breach !== null);
	}

	private getCpuBreach(monitor: Monitor, hardware: HardwareStatusPayload["data"]): ThresholdBreach | null {
		const threshold = monitor.cpuAlertThreshold;
		const usageDecimal = hardware?.cpu?.usage_percent;
		if (threshold === undefined || threshold === null || usageDecimal === undefined) {
			return null;
		}

		const cpuPercent = usageDecimal * 100;
		if (cpuPercent <= threshold) {
			return null;
		}

		return {
			metric: "cpu",
			currentValue: cpuPercent,
			threshold,
			unit: "%",
			formattedValue: `${cpuPercent.toFixed(1)}%`,
		};
	}

	private getMemoryBreach(monitor: Monitor, hardware: HardwareStatusPayload["data"]): ThresholdBreach | null {
		const threshold = monitor.memoryAlertThreshold;
		const usageDecimal = hardware?.memory?.usage_percent;
		if (threshold === undefined || threshold === null || usageDecimal === undefined) {
			return null;
		}

		const memoryPercent = usageDecimal * 100;
		if (memoryPercent <= threshold) {
			return null;
		}

		return {
			metric: "memory",
			currentValue: memoryPercent,
			threshold,
			unit: "%",
			formattedValue: `${memoryPercent.toFixed(1)}%`,
		};
	}

	private getDiskBreach(monitor: Monitor, hardware: HardwareStatusPayload["data"]): ThresholdBreach | null {
		const threshold = monitor.diskAlertThreshold;
		if (threshold === undefined || threshold === null || !Array.isArray(hardware?.disk)) {
			return null;
		}

		const maxDiskUsageDecimal = hardware.disk.reduce((highestUsage, disk) => {
			return disk.usage_percent !== undefined && disk.usage_percent > highestUsage ? disk.usage_percent : highestUsage;
		}, 0);
		const maxDiskPercent = maxDiskUsageDecimal * 100;
		if (maxDiskPercent <= threshold) {
			return null;
		}

		return {
			metric: "disk",
			currentValue: maxDiskPercent,
			threshold,
			unit: "%",
			formattedValue: `${maxDiskPercent.toFixed(1)}%`,
		};
	}

	private getTempBreach(monitor: Monitor, hardware: HardwareStatusPayload["data"]): ThresholdBreach | null {
		const threshold = monitor.tempAlertThreshold;
		if (threshold === undefined || threshold === null || !hardware?.cpu?.temperature) {
			return null;
		}

		const temps = Array.isArray(hardware.cpu.temperature) ? hardware.cpu.temperature : [hardware.cpu.temperature];
		const maxTemp = Math.max(...temps.filter((value: number) => !Number.isNaN(value)));
		if (maxTemp < threshold) {
			return null;
		}

		return {
			metric: "temp",
			currentValue: maxTemp,
			threshold,
			unit: "°C",
			formattedValue: `${maxTemp.toFixed(1)}°C`,
		};
	}
}
