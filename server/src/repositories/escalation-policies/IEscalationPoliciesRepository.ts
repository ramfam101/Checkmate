import type { EscalationPolicy } from "@/types/index.js";

export interface IEscalationPoliciesRepository {
	// create
	create(data: Partial<EscalationPolicy>): Promise<EscalationPolicy>;
	// fetch
	findById(id: string, teamId: string): Promise<EscalationPolicy>;
	findByTeamId(teamId: string): Promise<EscalationPolicy[]>;
	findActiveByMonitorId(monitorId: string, teamId: string): Promise<EscalationPolicy | null>;
	findActiveTeamWide(teamId: string): Promise<EscalationPolicy | null>;
	// update
	updateById(id: string, teamId: string, data: Partial<EscalationPolicy>): Promise<EscalationPolicy>;
	// delete
	deleteById(id: string, teamId: string): Promise<EscalationPolicy>;
}
