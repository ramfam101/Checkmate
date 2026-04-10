const SERVICE_NAME = "EscalationService";

import type { ILogger } from "@/utils/logger.js";

export interface IEscalationService {
	checkAndEscalate(): Promise<void>;
	acknowledgeIncident(incidentId: string, teamId: string): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	checkAndEscalate = async (): Promise<void> => {
		this.logger.debug({
			message: "Escalation handling now lives in SuperSimpleQueueHelper",
			service: SERVICE_NAME,
			method: "checkAndEscalate",
		});
	};

	acknowledgeIncident = async (incidentId: string, teamId: string): Promise<void> => {
		this.logger.debug({
			message: `Escalation acknowledgement is not wired for incident ${incidentId} on team ${teamId}`,
			service: SERVICE_NAME,
			method: "acknowledgeIncident",
		});
	};
}
