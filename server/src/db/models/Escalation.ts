import { Schema, model, type Types } from "mongoose";

export interface EscalationDocument {
	_id: Types.ObjectId;
	incidentId: Types.ObjectId;
	notificationId: Types.ObjectId;
	teamId: Types.ObjectId;
	delayMinutes: number;
	sentAt: Date | null;
	message?: string;
}

const EscalationSchema = new Schema<EscalationDocument>(
	{
		incidentId: {
			type: Schema.Types.ObjectId,
			ref: "Incident",
			required: true,
			index: true,
		},
		notificationId: {
			type: Schema.Types.ObjectId,
			ref: "Notification",
			required: true,
			index: true,
		},
		teamId: {
			type: Schema.Types.ObjectId,
			ref: "Team",
			required: true,
			index: true,
		},
		delayMinutes: {
			type: Number,
			required: true,
		},
		sentAt: {
			type: Date,
			default: null,
		},
		message: {
			type: String,
		},
	},
	{
		timestamps: true,
	}
);

EscalationSchema.index({ incidentId: 1, notificationId: 1, delayMinutes: 1 });
EscalationSchema.index({ teamId: 1, sentAt: -1 });

const EscalationModel = model<EscalationDocument>("Escalation", EscalationSchema);

export { EscalationModel };
export default EscalationModel;