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
