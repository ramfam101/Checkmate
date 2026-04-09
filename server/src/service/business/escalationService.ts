const SERVICE_NAME = "escalationService";
import type { Monitor } from "@/types/monitor.js";
import type { Incident, EscalationSent } from "@/types/index.js";
import type { ILogger } from "@/utils/logger.js";

/**
 * Represents an escalation that should be triggered
 */
interface PendingEscalation {
	levelIndex: number;
	minutesAfterStart: number;
	recipientNotificationId: string;
	sourceNotificationId: string;
}

export interface IEscalationService {
	getPendingEscalations(monitor: Monitor, incident: Incident): Promise<PendingEscalation[]>;
	recordEscalationSent(incident: Incident, levelIndex: number, notificationId: string, sourceNotificationId: string): EscalationSent;
}

/**
 * Service to handle escalation logic for incidents
 * Determines when escalation thresholds are met and which escalations to send
 */
export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	/**
	 * Get list of escalation levels that should be triggered
	 * Compares incident duration against escalation thresholds
	 * Excludes escalations that have already been sent
	 */
	getPendingEscalations = async (monitor: Monitor, incident: Incident): Promise<PendingEscalation[]> => {
		try {
			// Collect all escalation levels from monitor escalation
			const allEscalations: (PendingEscalation & { sourceNotificationId: string })[] = [];

			// Check monitor-level escalation
			if (monitor.escalation?.minutesAfterStart && monitor.escalation.notificationId) {
				allEscalations.push({
					levelIndex: 0, // Single level escalation
					minutesAfterStart: monitor.escalation.minutesAfterStart,
					recipientNotificationId: monitor.escalation.notificationId,
					sourceNotificationId: monitor.id, // Use monitor ID as source for monitor-level escalation
				});
			}

			// No escalations configured
			if (allEscalations.length === 0) {
				return [];
			}

			// Calculate incident duration in minutes
			const incidentStartTime = new Date(incident.startTime);
			const now = new Date();
			const durationMinutes = (now.getTime() - incidentStartTime.getTime()) / (1000 * 60);

			// Check which escalations have already been sent
			const alreadySentKeys = new Set(
				(incident.escalationsSent || []).map((e) => `${e.sourceNotificationId}:${e.levelIndex}:${e.notificationId}`)
			);

			// Find escalations that should be triggered now
			const pendingEscalations = allEscalations.filter((escalation) => {
				const thresholdMet = durationMinutes >= escalation.minutesAfterStart;
				const sentKey = `${escalation.sourceNotificationId}:${escalation.levelIndex}:${escalation.recipientNotificationId}`;
				const notSentYet = !alreadySentKeys.has(sentKey);

				return thresholdMet && notSentYet;
			});

			// Sort by source notification and level index
			pendingEscalations.sort((a, b) => {
				if (a.sourceNotificationId !== b.sourceNotificationId) {
					return a.sourceNotificationId.localeCompare(b.sourceNotificationId);
				}
				return a.levelIndex - b.levelIndex;
			});

			return pendingEscalations;
		} catch (error) {
			this.logger.error({
				message: "Error getting pending escalations",
				service: SERVICE_NAME,
				method: "getPendingEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return [];
		}
	};

	/**
	 * Create an EscalationSent record to track when an escalation was sent
	 */
	recordEscalationSent = (incident: Incident, levelIndex: number, notificationId: string, sourceNotificationId: string): EscalationSent => {
		return {
			levelIndex,
			sentAt: new Date().toISOString(),
			notificationId,
			sourceNotificationId,
		};
	};
}
