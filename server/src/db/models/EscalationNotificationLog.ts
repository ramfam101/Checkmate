import { Schema, model, type Types } from "mongoose";

interface EscalationNotificationLogDocument {
	_id: Types.ObjectId;
	incidentId: Types.ObjectId;
	escalationNotificationId: Types.ObjectId;
	sentAt: Date;
	notificationChannel: string;
	status: "sent" | "failed";
	errorMessage?: string;
	createdAt: Date;
	updatedAt: Date;
}

const EscalationNotificationLogSchema = new Schema<EscalationNotificationLogDocument>(
	{
		incidentId: {
			type: Schema.Types.ObjectId,
			ref: "Incident",
			required: true,
			index: true,
		},
		escalationNotificationId: {
			type: Schema.Types.ObjectId,
			ref: "EscalationNotification",
			required: true,
			index: true,
		},
		sentAt: {
			type: Date,
			required: true,
			index: true,
		},
		notificationChannel: {
			type: String,
			required: true,
		},
		status: {
			type: String,
			enum: ["sent", "failed"],
			required: true,
		},
		errorMessage: {
			type: String,
		},
	},
	{
		timestamps: true,
	}
);

// Compound indexes for efficient queries
EscalationNotificationLogSchema.index({ incidentId: 1, escalationNotificationId: 1 }, { unique: true });
EscalationNotificationLogSchema.index({ sentAt: -1 });

const EscalationNotificationLogModel = model<EscalationNotificationLogDocument>("EscalationNotificationLog", EscalationNotificationLogSchema);

export type { EscalationNotificationLogDocument };
export { EscalationNotificationLogModel };
export default EscalationNotificationLogModel;