import { Schema, model, type Types } from "mongoose";
import type { Notification, NotificationChannel } from "@/types/notification.js";

interface IEscalation {
	delayMinutes: number;
	channelId: Types.ObjectId | string;
}

interface NotificationDocument extends Omit<Notification, "id" | "userId" | "teamId" | "createdAt" | "updatedAt"> {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	teamId: Types.ObjectId;
	createdAt: Date;
	updatedAt: Date;

	// added escalations config
	escalations?: IEscalation[];
}

const EscalationSchema = new Schema<IEscalation>({
	delayMinutes: { type: Number, required: true, default: 0 },
	channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
});

const NotificationSchema = new Schema<NotificationDocument>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			immutable: true,
			required: true,
		},
		teamId: {
			type: Schema.Types.ObjectId,
			ref: "Team",
			immutable: true,
			required: true,
		},
		type: {
			type: String,
			enum: ["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams", "telegram"] as NotificationChannel[],
			required: true,
		},
		notificationName: {
			type: String,
			required: true,
		},
		address: { type: String },
		phone: { type: String },
		homeserverUrl: { type: String },
		roomId: { type: String },
		accessToken: { type: String },

		// escalations array for notification escalations
		escalations: { type: [EscalationSchema], default: [] },
	},
	{
		timestamps: true,
	}
);

const NotificationModel = model<NotificationDocument>("Notification", NotificationSchema);

export type { NotificationDocument };
export { NotificationModel };
export default NotificationModel;
