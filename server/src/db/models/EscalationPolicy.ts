import { Schema, model, type Types } from "mongoose";
import type { EscalationPolicy, EscalationRule } from "@/types/escalation.js";

type EscalationRuleDocumentBase = Omit<EscalationRule, "id" | "notificationIds"> & {
	notificationIds: Types.ObjectId[];
};

interface EscalationRuleDocument extends EscalationRuleDocumentBase {
	_id: Types.ObjectId;
}

type EscalationPolicyDocumentBase = Omit<EscalationPolicy, "id" | "teamId" | "monitorId" | "escalationRules" | "createdAt" | "updatedAt"> & {
	teamId: Types.ObjectId;
	monitorId?: Types.ObjectId | null;
	escalationRules: EscalationRuleDocument[];
	createdAt: Date;
	updatedAt: Date;
};

export interface EscalationPolicyDocument extends EscalationPolicyDocumentBase {
	_id: Types.ObjectId;
}

const EscalationRuleSchema = new Schema<EscalationRuleDocument>(
	{
		level: {
			type: Number,
			required: true,
			min: 1,
		},
		durationMinutes: {
			type: Number,
			required: true,
			min: 0,
		},
		notificationIds: [
			{
				type: Schema.Types.ObjectId,
				ref: "Notification",
			},
		],
		message: {
			type: String,
			default: null,
		},
	},
	{ _id: true }
);

const EscalationPolicySchema = new Schema<EscalationPolicyDocument>(
	{
		teamId: {
			type: Schema.Types.ObjectId,
			ref: "Team",
			required: true,
			immutable: true,
			index: true,
		},
		monitorId: {
			type: Schema.Types.ObjectId,
			ref: "Monitor",
			default: null,
			index: true,
		},
		name: {
			type: String,
			required: true,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		escalationRules: {
			type: [EscalationRuleSchema],
			default: [],
		},
	},
	{ timestamps: true }
);

EscalationPolicySchema.index({ teamId: 1, isActive: 1 });
EscalationPolicySchema.index({ teamId: 1, monitorId: 1 });

const EscalationPolicyModel = model<EscalationPolicyDocument>("EscalationPolicy", EscalationPolicySchema);

export type { EscalationRuleDocument };
export { EscalationPolicyModel };
export default EscalationPolicyModel;
