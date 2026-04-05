import { Schema, model } from "mongoose";

interface Escalation {
	delay: number;
	channel: string;
}

interface SimpleMonitorDocument {
	name: string;
	escalations: Escalation[];
}

const EscalationSchema = new Schema<Escalation>(
	{
		delay: { type: Number },
		channel: { type: String },
	},
	{ _id: false }
);

const SimpleMonitorSchema = new Schema<SimpleMonitorDocument>(
	{
		name: { type: String, required: true },
		escalations: { type: [EscalationSchema], default: [] },
	},
	{ timestamps: true }
);

const SimpleMonitorModel = model<SimpleMonitorDocument>("SimpleMonitor", SimpleMonitorSchema);

export default SimpleMonitorModel;
