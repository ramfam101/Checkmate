import type { EscalationHistory } from "@/types/index.js";

export interface IEscalationHistoryRepository {
	// create
	create(data: Partial<EscalationHistory>): Promise<EscalationHistory>;
	// fetch
	findById(id: string): Promise<EscalationHistory>;
	findByIncidentId(incidentId: string): Promise<EscalationHistory | null>;
	findByTeamId(teamId: string): Promise<EscalationHistory[]>;
	// update
	updateById(id: string, data: Partial<EscalationHistory>): Promise<EscalationHistory>;
	// delete
	deleteByIncidentId(incidentId: string): Promise<number>;
}
