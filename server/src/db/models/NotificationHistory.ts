import { Schema, model, type Types } from "mongoose";

export interface NotificationHistory {
	id: string;
	incidentId: string;
	notificationId: string;
	escalationId?: string; // ID of the escalation level that was sent
	sentAt: Date;
	status: "sent" | "failed";
	errorMessage?: string;
}

interface NotificationHistoryDocument extends Omit<NotificationHistory, "id" | "incidentId" | "notificationId" | "sentAt"> {
	_id: Types.ObjectId;
	incidentId: Types.ObjectId;
	notificationId: Types.ObjectId;
	sentAt: Date;
}

const NotificationHistorySchema = new Schema<NotificationHistoryDocument>(
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
		escalationId: {
			type: String,
			default: null,
		},
		sentAt: {
			type: Date,
			default: Date.now,
			index: true,
		},
		status: {
			type: String,
			enum: ["sent", "failed"],
			required: true,
		},
		errorMessage: {
			type: String,
			default: null,
		},
	},
	{
		timestamps: true,
	}
);

// Compound indexes for efficient queries
NotificationHistorySchema.index({ incidentId: 1, notificationId: 1 });
NotificationHistorySchema.index({ incidentId: 1, escalationId: 1 });
NotificationHistorySchema.index({ sentAt: -1 });

const NotificationHistoryModel = model<NotificationHistoryDocument>("NotificationHistory", NotificationHistorySchema);

export type { NotificationHistoryDocument };
export { NotificationHistoryModel };
export default NotificationHistoryModel;