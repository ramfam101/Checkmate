import { MonitorModel, IncidentModel } from "../models/index.js";
import { logger } from "@/utils/logger.js";

export async function addEscalationDefaults(): Promise<void> {
	const SERVICE_NAME = "Migration:AddEscalationDefaults";

	try {
		logger.info({ service: SERVICE_NAME, message: "Starting escalation defaults migration" });

		const monitorsResult = await MonitorModel.updateMany(
			{
				$or: [{ escalationAfterMinutes: { $exists: false } }, { escalationNotifications: { $exists: false } }],
			},
			[
				{
					$set: {
						escalationAfterMinutes: { $ifNull: ["$escalationAfterMinutes", null] },
						escalationNotifications: { $ifNull: ["$escalationNotifications", []] },
					},
				},
			]
		);

		const incidentsResult = await IncidentModel.updateMany(
			{ escalationSentAt: { $exists: false } },
			[
				{
					$set: {
						escalationSentAt: { $ifNull: ["$escalationSentAt", null] },
					},
				},
			]
		);

		logger.info({
			service: SERVICE_NAME,
			message: "Escalation defaults migration complete",
			details: {
				monitorsUpdated: monitorsResult.modifiedCount,
				incidentsUpdated: incidentsResult.modifiedCount,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({ service: SERVICE_NAME, message: `Error during escalation defaults migration: ${errorMessage}` });
		throw error;
	}
}
