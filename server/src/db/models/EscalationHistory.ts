import { Schema, model, type Types } from "mongoose";
import { EscalationRuleStatuses, type EscalationHistory, type TriggeredRule } from "@/types/escalation.js";

type TriggeredRuleDocumentBase = Omit<TriggeredRule, "id" | "ruleId" | "notificationIds" | "sentAt"> & {
	ruleId: Types.ObjectId;
	notificationIds: Types.ObjectId[];
	sentAt: Date;
};

interface TriggeredRuleDocument extends TriggeredRuleDocumentBase {
	_id: Types.ObjectId;
}

type EscalationHistoryDocumentBase = Omit<EscalationHistory, "id" | "incidentId" | "monitorId" | "teamId" | "escalationPolicyId" | "triggeredRules" | "createdAt" | "updatedAt"> & {
	incidentId: Types.ObjectId;
	monitorId: Types.ObjectId;
	teamId: Types.ObjectId;
	escalationPolicyId: Types.ObjectId;
	triggeredRules: TriggeredRuleDocument[];
	createdAt: Date;
	updatedAt: Date;
};

export interface EscalationHistoryDocument extends EscalationHistoryDocumentBase {
	_id: Types.ObjectId;
}

const TriggeredRuleSchema = new Schema<TriggeredRuleDocument>(
	{
		level: {
			type: Number,
			required: true,
		},
		ruleId: {
			type: Schema.Types.ObjectId,
			required: true,
		},
		notificationIds: [
			{
				type: Schema.Types.ObjectId,
				ref: "Notification",
			},
		],
		sentAt: {
			type: Date,
			required: true,
		},
		status: {
			type: String,
			enum: EscalationRuleStatuses,
			default: "pending",
		},
	},
	{ _id: true }
);

const EscalationHistorySchema = new Schema<EscalationHistoryDocument>(
	{
		incidentId: {
			type: Schema.Types.ObjectId,
			ref: "Incident",
			required: true,
			index: true,
		},
		monitorId: {
			type: Schema.Types.ObjectId,
			ref: "Monitor",
			required: true,
			index: true,
		},
		teamId: {
			type: Schema.Types.ObjectId,
			ref: "Team",
			required: true,
			index: true,
		},
		escalationPolicyId: {
			type: Schema.Types.ObjectId,
			ref: "EscalationPolicy",
			required: true,
		},
		triggeredRules: {
			type: [TriggeredRuleSchema],
			default: [],
		},
	},
	{ timestamps: true }
);

EscalationHistorySchema.index({ incidentId: 1, escalationPolicyId: 1 });
EscalationHistorySchema.index({ teamId: 1, createdAt: -1 });

const EscalationHistoryModel = model<EscalationHistoryDocument>("EscalationHistory", EscalationHistorySchema);

export type { TriggeredRuleDocument };
export { EscalationHistoryModel };
export default EscalationHistoryModel;
