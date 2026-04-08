import mongoose, { Schema, Document } from "mongoose";

export interface EscalationTrackerDocument extends Document {
	incidentId: mongoose.Types.ObjectId;
	monitorId: mongoose.Types.ObjectId;
	teamId: mongoose.Types.ObjectId;
	escalationRuleId: string;
	primaryNotificationId: mongoose.Types.ObjectId;
	escalationNotificationId: mongoose.Types.ObjectId;
	delayMinutes: number;
	createdAt: Date;
	escalatedAt?: Date;
	acknowledgedAt?: Date;
	isEscalated: boolean;
}

const escalationTrackerSchema = new Schema<EscalationTrackerDocument>(
	{
		incidentId: {
			type: Schema.Types.ObjectId,
			ref: "Incident",
			required: true,
		},
		monitorId: {
			type: Schema.Types.ObjectId,
			ref: "Monitor",
			required: true,
		},
		teamId: {
			type: Schema.Types.ObjectId,
			ref: "Team",
			required: true,
		},
		escalationRuleId: {
			type: String,
			required: true,
		},
		primaryNotificationId: {
			type: Schema.Types.ObjectId,
			ref: "Notification",
			required: true,
		},
		escalationNotificationId: {
			type: Schema.Types.ObjectId,
			ref: "Notification",
			required: true,
		},
		delayMinutes: {
			type: Number,
			required: true,
			min: 0,
			max: 1440, // max 24 hours
		},
		createdAt: {
			type: Date,
			default: Date.now,
		},
		escalatedAt: {
			type: Date,
		},
		acknowledgedAt: {
			type: Date,
		},
		isEscalated: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true }
);

// Create indexes for faster queries
escalationTrackerSchema.index({ incidentId: 1, escalationRuleId: 1 }, { unique: true });
escalationTrackerSchema.index({ incidentId: 1 });
escalationTrackerSchema.index({ monitorId: 1 });
escalationTrackerSchema.index({ teamId: 1 });
escalationTrackerSchema.index({ isEscalated: 1, createdAt: 1 });

export const EscalationTrackerModel = mongoose.model<EscalationTrackerDocument>(
	"EscalationTracker",
	escalationTrackerSchema
);