export const EscalationRuleStatuses = ["pending", "sent", "failed"] as const;
export type EscalationRuleStatus = (typeof EscalationRuleStatuses)[number];

export interface EscalationRule {
	id?: string;
	level: number;
	durationMinutes: number;
	notificationIds: string[];
	message?: string | null;
}

export interface EscalationPolicy {
	id: string;
	teamId: string;
	monitorId?: string | null;
	name: string;
	isActive: boolean;
	escalationRules: EscalationRule[];
	createdAt: string;
	updatedAt: string;
}

export interface TriggeredRule {
	id?: string;
	level: number;
	ruleId: string;
	notificationIds: string[];
	sentAt: string;
	status: EscalationRuleStatus;
}

export interface EscalationHistory {
	id: string;
	incidentId: string;
	monitorId: string;
	teamId: string;
	escalationPolicyId: string;
	triggeredRules: TriggeredRule[];
	createdAt: string;
	updatedAt: string;
}
