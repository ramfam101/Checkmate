import { Schema, model, Types } from "mongoose";

const EscalationEventSchema = new Schema(
  {
    incidentId: {
      type: Types.ObjectId,
      ref: "Incident",
      required: true,
      index: true,
    },
    ruleId: {
      type: Types.ObjectId,
      ref: "EscalationRule",
      required: true,
      index: true,
    },
    firedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const EscalationEventModel = model("EscalationEvent", EscalationEventSchema);
