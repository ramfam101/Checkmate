import { Schema, model, Types } from "mongoose";

interface EscalationLogDocument {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  monitorId: Types.ObjectId;
  teamId: Types.ObjectId;
  channelId: Types.ObjectId;
  triggerTime: Date;
  sent: boolean;
  createdAt: Date;
}

const EscalationLogSchema = new Schema<EscalationLogDocument>(
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
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Notification",
      required: true,
    },
    triggerTime: {
      type: Date,
      required: true,
    },
    sent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

EscalationLogSchema.index({ monitorId: 1, incidentId: 1 });

const EscalationLogModel = model<EscalationLogDocument>("EscalationLog", EscalationLogSchema);

export type { EscalationLogDocument };
export { EscalationLogModel };
export default EscalationLogModel;