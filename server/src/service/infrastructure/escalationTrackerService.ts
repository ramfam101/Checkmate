import type { ILogger } from "@/utils/logger.js";

interface IncidentState {
	monitorId: string;
	incidentStartTime: number;
	sentEscalationDelays: Set<number>;
}

export class EscalationTrackerService {
	private incidentStates: Map<string, IncidentState> = new Map();
	private logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	/**
	 * Track a new incident for a monitor
	 */
	trackIncident(monitorId: string): void {
		if (!this.incidentStates.has(monitorId)) {
			this.incidentStates.set(monitorId, {
				monitorId,
				incidentStartTime: Date.now(),
				sentEscalationDelays: new Set(),
			});
			this.logger.info({
				message: `Incident tracked for monitor ${monitorId}`,
				service: "EscalationTrackerService",
			});
		}
	}

	/**
	 * Mark an incident as resolved
	 */
	resolveIncident(monitorId: string): void {
		if (this.incidentStates.has(monitorId)) {
			this.incidentStates.delete(monitorId);
			this.logger.info({
				message: `Incident resolved for monitor ${monitorId}`,
				service: "EscalationTrackerService",
			});
		}
	}

	/**
	 * Check if an escalation should be sent
	 */
	shouldSendEscalation(monitorId: string, delayMinutes: number): boolean {
		const state = this.incidentStates.get(monitorId);
		if (!state) return false;

		const elapsedMinutes = (Date.now() - state.incidentStartTime) / (1000 * 60);
		const shouldSend = elapsedMinutes >= delayMinutes && !state.sentEscalationDelays.has(delayMinutes);

		if (shouldSend) {
			state.sentEscalationDelays.add(delayMinutes);
			this.logger.info({
				message: `Escalation triggered for monitor ${monitorId} after ${delayMinutes} minutes`,
				service: "EscalationTrackerService",
			});
		}

		return shouldSend;
	}

	/**
	 * Get current incident duration in minutes
	 */
	getIncidentDuration(monitorId: string): number | null {
		const state = this.incidentStates.get(monitorId);
		if (!state) return null;
		return (Date.now() - state.incidentStartTime) / (1000 * 60);
	}

	/**
	 * Check if monitor has an active incident
	 */
	hasActiveIncident(monitorId: string): boolean {
		return this.incidentStates.has(monitorId);
	}
}
