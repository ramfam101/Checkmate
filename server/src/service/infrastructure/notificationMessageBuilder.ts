import type { HardwareStatusPayload, Incident, Monitor, MonitorStatusResponse } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type {
	NotificationMessage,
	NotificationType,
	NotificationSeverity,
	ThresholdBreach,
	NotificationContent,
	IncidentInfo,
} from "@/types/notificationMessage.js";

export interface INotificationMessageBuilder {
	buildMessage(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		clientHost: string,
		incident?: Incident | null
	): NotificationMessage;
	extractThresholdBreaches(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse): ThresholdBreach[];
}

const SERVICE_NAME = "NotificationMessageBuilder";

export class NotificationMessageBuilder implements INotificationMessageBuilder {
	static SERVICE_NAME = SERVICE_NAME;

	buildMessage(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		clientHost: string,
		incident?: Incident | null
	): NotificationMessage {
		const type = this.determineNotificationType(decision, monitor);
		const severity = this.determineSeverity(type);
		const incidentInfo = incident ? this.buildIncidentInfo(incident, clientHost) : undefined;
		const content = this.buildContent(type, monitor, monitorStatusResponse, decision, incidentInfo);

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
				isEscalation: decision.isEscalation,
				escalationMinutes: decision.escalationMinutes,
				incidentId: incident?.id,
			},
		};
	}

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

	private buildContent(
		type: NotificationType,
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		incident?: IncidentInfo
	): NotificationContent {
		switch (type) {
			case "monitor_down":
				return this.buildMonitorDownContent(monitor, monitorStatusResponse, decision, incident);
			case "monitor_up":
				return this.buildMonitorUpContent(monitor, incident);
			case "threshold_breach":
				return this.buildThresholdBreachContent(
					monitor,
					monitorStatusResponse as MonitorStatusResponse<HardwareStatusPayload>,
					decision,
					incident
				);
			case "threshold_resolved":
				return this.buildThresholdResolvedContent(monitor, incident);
			default:
				return this.buildDefaultContent(monitor, incident);
		}
	}

	private buildMonitorDownContent(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision,
		incident?: IncidentInfo
	): NotificationContent {
		const title = decision.isEscalation ? `Escalation: ${monitor.name} is still down` : `Monitor Down: ${monitor.name}`;
		const summary = decision.isEscalation
			? `Monitor "${monitor.name}" is still down after ${incident?.duration ?? `${decision.escalationMinutes || 0} minute(s)`}.`
			: `Monitor "${monitor.name}" is currently down and unreachable.`;
		const details = [`URL: ${monitor.url}`, `Status: Down`, `Type: ${monitor.type}`];

		if (incident?.duration) {
			details.push(`Incident duration: ${incident.duration}`);
		}

		if (decision.isEscalation && decision.escalationMinutes) {
			details.push(`Escalation trigger: ${decision.escalationMinutes} minute(s)`);
		}

		if (monitorStatusResponse.code) {
			details.push(`Response Code: ${monitorStatusResponse.code}`);
		}

		if (monitorStatusResponse.message) {
			details.push(`Error: ${monitorStatusResponse.message}`);
		}

		return {
			title,
			summary,
			details,
			incident,
			timestamp: new Date(),
		};
	}

	private buildMonitorUpContent(monitor: Monitor, incident?: IncidentInfo): NotificationContent {
		const title = `Monitor Recovered: ${monitor.name}`;
		const summary = incident?.duration
			? `Monitor "${monitor.name}" is back up after ${incident.duration}.`
			: `Monitor "${monitor.name}" is back up and operational.`;
		const details = [`URL: ${monitor.url}`, `Status: Up`, `Type: ${monitor.type}`];

		if (incident?.duration) {
			details.push(`Incident duration: ${incident.duration}`);
		}

		return {
			title,
			summary,
			details,
			incident,
			timestamp: new Date(),
		};
	}

	private buildThresholdBreachContent(
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse<HardwareStatusPayload>,
		decision: MonitorActionDecision,
		incident?: IncidentInfo
	): NotificationContent {
		const title = decision.isEscalation ? `Escalation: Threshold still exceeded on ${monitor.name}` : `Threshold Exceeded: ${monitor.name}`;
		const summary = decision.isEscalation
			? `Monitor "${monitor.name}" has remained above one or more thresholds for ${incident?.duration ?? `${decision.escalationMinutes || 0} minute(s)`}.`
			: `Monitor "${monitor.name}" has exceeded one or more thresholds.`;
		const details = [`URL: ${monitor.url}`, `Status: Threshold exceeded`, `Type: ${monitor.type}`];
		const thresholds = this.extractThresholdBreaches(monitor, monitorStatusResponse);

		if (incident?.duration) {
			details.push(`Incident duration: ${incident.duration}`);
		}

		if (decision.isEscalation && decision.escalationMinutes) {
			details.push(`Escalation trigger: ${decision.escalationMinutes} minute(s)`);
		}

		return {
			title,
			summary,
			details,
			thresholds,
			incident,
			timestamp: new Date(),
		};
	}

	private buildThresholdResolvedContent(monitor: Monitor, incident?: IncidentInfo): NotificationContent {
		const title = `Thresholds Resolved: ${monitor.name}`;
		const summary = incident?.duration
			? `Monitor "${monitor.name}" thresholds returned to normal after ${incident.duration}.`
			: `Monitor "${monitor.name}" thresholds have returned to normal.`;
		const details = [`URL: ${monitor.url}`, `Status: Up`, `Type: ${monitor.type}`];

		if (incident?.duration) {
			details.push(`Incident duration: ${incident.duration}`);
		}

		return {
			title,
			summary,
			details,
			incident,
			timestamp: new Date(),
		};
	}

	private buildDefaultContent(monitor: Monitor, incident?: IncidentInfo): NotificationContent {
		return {
			title: `Monitor: ${monitor.name}`,
			summary: `Status update for monitor "${monitor.name}".`,
			details: [`URL: ${monitor.url}`, `Status: ${monitor.status}`, `Type: ${monitor.type}`],
			incident,
			timestamp: new Date(),
		};
	}

	private buildIncidentInfo(incident: Incident, clientHost: string): IncidentInfo {
		const createdAt = new Date(incident.startTime);
		const resolvedAt = incident.endTime ? new Date(incident.endTime) : undefined;
		const safeClientHost = clientHost.endsWith("/") ? clientHost.slice(0, -1) : clientHost;

		return {
			id: incident.id,
			url: `${safeClientHost}/incidents/${incident.monitorId}`,
			createdAt,
			resolvedAt,
			duration: this.formatDuration(createdAt, resolvedAt),
		};
	}

	private formatDuration(start: Date, end = new Date()): string {
		const durationMs = end.getTime() - start.getTime();

		if (!Number.isFinite(durationMs) || durationMs < 0) {
			return "0 minutes";
		}

		const totalMinutes = Math.floor(durationMs / 60000);
		const days = Math.floor(totalMinutes / 1440);
		const hours = Math.floor((totalMinutes % 1440) / 60);
		const minutes = totalMinutes % 60;
		const parts: string[] = [];

		if (days > 0) {
			parts.push(`${days} day${days === 1 ? "" : "s"}`);
		}
		if (hours > 0) {
			parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
		}
		if (minutes > 0 || parts.length === 0) {
			parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
		}

		return parts.join(", ");
	}

	public extractThresholdBreaches(monitor: Monitor, monitorStatusResponse: MonitorStatusResponse<HardwareStatusPayload>): ThresholdBreach[] {
		const breaches: ThresholdBreach[] = [];

		// Check if this is a hardware monitor with threshold data
		if (monitor.type !== "hardware" || !monitorStatusResponse.payload) {
			return breaches;
		}

		// Cast to HardwareStatusPayload type
		const payload = monitorStatusResponse.payload;
		const hardware = payload.data;

		if (!hardware) {
			return breaches;
		}

		// Note: usage_percent values in hardware payload are decimals (0-1)
		if (monitor.cpuAlertThreshold !== undefined && monitor.cpuAlertThreshold !== null && hardware.cpu?.usage_percent !== undefined) {
			const cpuUsageDecimal = hardware.cpu.usage_percent;
			const cpuPercent = cpuUsageDecimal * 100;
			const threshold = monitor.cpuAlertThreshold;
			if (cpuPercent > threshold) {
				breaches.push({
					metric: "cpu",
					currentValue: cpuPercent,
					threshold,
					unit: "%",
					formattedValue: `${cpuPercent.toFixed(1)}%`,
				});
			}
		}

		// Memory threshold breach
		if (monitor.memoryAlertThreshold !== undefined && monitor.memoryAlertThreshold !== null && hardware.memory?.usage_percent !== undefined) {
			const memoryUsageDecimal = hardware.memory.usage_percent;
			const memoryPercent = memoryUsageDecimal * 100;
			const threshold = monitor.memoryAlertThreshold;
			if (memoryPercent > threshold) {
				breaches.push({
					metric: "memory",
					currentValue: memoryPercent,
					threshold,
					unit: "%",
					formattedValue: `${memoryPercent.toFixed(1)}%`,
				});
			}
		}

		// Disk threshold breach
		if (monitor.diskAlertThreshold !== undefined && monitor.diskAlertThreshold !== null && Array.isArray(hardware.disk)) {
			// Find the highest disk usage
			let maxDiskUsageDecimal = 0;
			for (const disk of hardware.disk) {
				if (disk.usage_percent !== undefined && disk.usage_percent > maxDiskUsageDecimal) {
					maxDiskUsageDecimal = disk.usage_percent;
				}
			}
			const maxDiskPercent = maxDiskUsageDecimal * 100;
			const threshold = monitor.diskAlertThreshold;
			if (maxDiskPercent > threshold) {
				breaches.push({
					metric: "disk",
					currentValue: maxDiskPercent,
					threshold,
					unit: "%",
					formattedValue: `${maxDiskPercent.toFixed(1)}%`,
				});
			}
		}

		// Temperature threshold breach
		if (monitor.tempAlertThreshold !== undefined && monitor.tempAlertThreshold !== null && hardware.cpu?.temperature) {
			// Temperature is an array in cpu.temperature
			const temps = Array.isArray(hardware.cpu.temperature) ? hardware.cpu.temperature : [hardware.cpu.temperature];
			const maxTemp = Math.max(...temps.filter((t: number) => !isNaN(t)));
			const threshold = monitor.tempAlertThreshold;
			if (maxTemp >= threshold) {
				breaches.push({
					metric: "temp",
					currentValue: maxTemp,
					threshold,
					unit: "°C",
					formattedValue: `${maxTemp.toFixed(1)}°C`,
				});
			}
		}

		return breaches;
	}
}
