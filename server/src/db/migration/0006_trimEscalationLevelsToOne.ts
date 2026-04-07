import { NotificationModel } from "../models/Notification.js";
import { logger } from "@/utils/logger.js";

/**
 * Trim escalation levels to maximum 1 per notification
 * Keeps only the first escalation level if multiple exist
 */
export async function trimEscalationLevelsToOne(): Promise<void> {
	const SERVICE_NAME = "Migration:TrimEscalationLevelsToOne";

	try {
		logger.info({ service: SERVICE_NAME, message: "Starting escalation levels trim" });

		// Find all notifications with more than 1 escalation level
		const result = await NotificationModel.updateMany(
			{
				"escalation.levels": { $exists: true },
				"escalation.levels.1": { $exists: true }, // Has at least 2 items
			},
			[
				{
					$set: {
						"escalation.levels": {
							$slice: ["$escalation.levels", 1], // Keep only first element
						},
					},
				},
			]
		);

		logger.info({
			service: SERVICE_NAME,
			message: `Trim completed: ${result.modifiedCount} notifications updated`,
		});
	} catch (error) {
		logger.error({
			service: SERVICE_NAME,
			message: "Migration failed",
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
