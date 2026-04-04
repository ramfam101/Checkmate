export interface EscalationRule {
	delayMinutes: number;
	notificationIds: string[];
}

export interface EscalationPolicy {
	id: string;
	teamId: string;
	name: string;
	description?: string;
	rules: EscalationRule[];
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CreateEscalationPolicyRequest {
	name: string;
	description?: string;
	rules: EscalationRule[];
	enabled: boolean;
}

export interface UpdateEscalationPolicyRequest extends Partial<CreateEscalationPolicyRequest> {}
