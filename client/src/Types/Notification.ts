export const NotificationChannels = [
	"email",
	"slack",
	"discord",
	"webhook",
	"pager_duty",
	"matrix",
	"teams",
] as const;
export type NotificationChannel = (typeof NotificationChannels)[number];

export const EscalationRuleChannels = ["email", "slack", "discord", "webhook"] as const;
export type EscalationRuleChannel = (typeof EscalationRuleChannels)[number];

export interface EscalationRule {
	type: EscalationRuleChannel;
	delayMinutes: number;
	trigger: "escalation";
}

export interface Notification {
	id: string;
	userId: string;
	teamId: string;
	type: NotificationChannel;
	notificationName: string;
	address?: string;
	phone?: string;
	homeserverUrl?: string;
	roomId?: string;
	accessToken?: string;
	escalationRules: EscalationRule[];
	createdAt: string;
	updatedAt: string;
}
