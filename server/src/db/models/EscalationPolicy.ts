import { Schema, model, type Types } from "mongoose";
import type { EscalationPolicy, EscalationRule } from "@/types/notification.js";

interface EscalationRuleDocument extends EscalationRule {
	_id?: Types.ObjectId;
}

type EscalationPolicyDocumentBase = Omit<EscalationPolicy, "id" | "teamId" | "createdAt" | "updatedAt"> & {
	teamId: Types.ObjectId;
	createdAt: Date;
	updatedAt: Date;
};

export interface EscalationPolicyDocument extends EscalationPolicyDocumentBase {
	_id: Types.ObjectId;
}

const escalationRuleSchema = new Schema<EscalationRuleDocument>(
	{
		delayMinutes: {
			type: Number,
			required: true,
			min: 1,
		},
		notificationIds: [
			{
				type: Schema.Types.ObjectId,
				ref: "Notification",
			},
		],
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
		name: {
			type: String,
			required: true,
			maxlength: 100,
			trim: true,
		},
		description: {
			type: String,
			maxlength: 500,
			trim: true,
		},
		rules: {
			type: [escalationRuleSchema],
			required: true,
			validate: {
				validator: (v: EscalationRuleDocument[]) => v.length > 0,
				message: "At least one escalation rule is required",
			},
		},
		enabled: {
			type: Boolean,
			default: true,
			index: true,
		},
	},
	{
		timestamps: true,
	}
);

// Ensure rules are sorted by delayMinutes
EscalationPolicySchema.pre("save", function (next) {
	if (this.rules && Array.isArray(this.rules)) {
		this.rules.sort((a, b) => a.delayMinutes - b.delayMinutes);
	}
	next();
});

// Index for common queries
EscalationPolicySchema.index({ teamId: 1, enabled: 1 });
EscalationPolicySchema.index({ teamId: 1, createdAt: -1 });

const EscalationPolicyModel = model<EscalationPolicyDocument>("EscalationPolicy", EscalationPolicySchema);

export { EscalationPolicyModel };
export default EscalationPolicyModel;

