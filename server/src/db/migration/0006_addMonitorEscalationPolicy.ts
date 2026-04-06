import { MonitorModel } from "@/db/models/index.js";

export async function addMonitorEscalationPolicy(): Promise<void> {
	await MonitorModel.updateMany(
		{ escalationPolicy: { $exists: false } },
		{
			$set: {
				escalationPolicy: [],
			},
		}
	);
}
