import { Schema, model, type Types } from "mongoose";

interface NotificationEscalationDocument {
	_id: Types.ObjectId;
	incidentId: Types.ObjectId;
	notificationId: Types.ObjectId;
	monitorId: Types.ObjectId;
	teamId: Types.ObjectId;
	delayMinutes: number;
	escalatedAt?: Date | null;
	status: "pending" | "escalated" | "resolved";
	createdAt: Date;
	updatedAt: Date;
}

const NotificationEscalationSchema = new Schema<NotificationEscalationDocument>(
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
		delayMinutes: {
			type: Number,
			required: true,
			default: 15,
			min: 0,
			max: 1440,
		},
		escalatedAt: {
			type: Date,
			default: null,
		},
		status: {
			type: String,
			enum: ["pending", "escalated", "resolved"],
			default: "pending",
			index: true,
		},
	},
	{ timestamps: true }
);

NotificationEscalationSchema.index({ incidentId: 1, status: 1 });
NotificationEscalationSchema.index({ teamId: 1, status: 1 });

const NotificationEscalationModel = model<NotificationEscalationDocument>("NotificationEscalation", NotificationEscalationSchema);

export type { NotificationEscalationDocument };
export { NotificationEscalationModel };
export default NotificationEscalationModel;
