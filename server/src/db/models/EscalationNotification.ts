import { Schema, model, type Types } from "mongoose";
import type { EscalationNotification, NotificationChannel } from "@/types/notification.js";

interface EscalationNotificationDocument extends Omit<EscalationNotification, "id" | "monitorId" | "createdAt" | "updatedAt"> {
	_id: Types.ObjectId;
	monitorId: Types.ObjectId;
	createdAt: Date;
	updatedAt: Date;
}

const EscalationNotificationSchema = new Schema<EscalationNotificationDocument>(
	{
		monitorId: {
			type: Schema.Types.ObjectId,
			ref: "Monitor",
			required: true,
			index: true,
		},
		escalationLevel: {
			type: Number,
			required: true,
			min: 1,
		},
		delaySeconds: {
			type: Number,
			required: true,
			min: 0,
		},
		notificationChannel: {
			type: String,
			enum: ["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams"] as NotificationChannel[],
			required: true,
		},
		isActive: {
			type: Boolean,
			default: true,
			index: true,
		},
	},
	{
		timestamps: true,
	}
);

// Compound indexes for efficient queries
EscalationNotificationSchema.index({ monitorId: 1, escalationLevel: 1 });
EscalationNotificationSchema.index({ monitorId: 1, isActive: 1 });

const EscalationNotificationModel = model<EscalationNotificationDocument>("EscalationNotification", EscalationNotificationSchema);

export type { EscalationNotificationDocument };
export { EscalationNotificationModel };
export default EscalationNotificationModel;