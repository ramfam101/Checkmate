import { Schema, model, type Types } from "mongoose";
import type { MonitorNotificationDispatchState } from "@/types/monitorNotificationDispatchState.js";

interface MonitorNotificationDispatchStateDocument
    extends Omit<
        MonitorNotificationDispatchState,
        "id" | "userId" | "teamId" | "monitorId" | "notificationId" | "createdAt" | "updatedAt" | "lastSentAt"
    > {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    teamId: Types.ObjectId;
    monitorId: Types.ObjectId;
    notificationId: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
    lastSentAt: Date | null;
}

const MonitorNotificationDispatchStateSchema = new Schema<MonitorNotificationDispatchStateDocument>(
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
        monitorId: {
            type: Schema.Types.ObjectId,
            ref: "Monitor",
            immutable: true,
            required: true,
        },
        notificationId: {
            type: Schema.Types.ObjectId,
            ref: "Notification",
            immutable: true,
            required: true,
        },
        lastSentAt: { type: Date, default: null },
    },
    {
        timestamps: true,
    }
);

const MonitorNotificationDispatchStateModel = model<MonitorNotificationDispatchStateDocument>(
    "MonitorNotificationDispatchState",
    MonitorNotificationDispatchStateSchema
);

export { MonitorNotificationDispatchStateModel, type MonitorNotificationDispatchStateDocument };
export default MonitorNotificationDispatchStateModel;