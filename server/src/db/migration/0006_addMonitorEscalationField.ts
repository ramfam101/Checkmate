import { MonitorModel } from "../models/Monitor.js";
import { logger } from "@/utils/logger.js";

/**
 * Backfills missing monitor escalation field to null for consistency.
 * MongoDB does not require structural migration for optional fields,
 * but we record this migration for release traceability.
 */
export async function addMonitorEscalationField(): Promise<void> {
	const SERVICE_NAME = "Migration:AddMonitorEscalationField";

	try {
		logger.info({ service: SERVICE_NAME, message: "Starting migration" });

		const result = await MonitorModel.updateMany(
			{ escalation: { $exists: false } },
			{ $set: { escalation: null } }
		);

		logger.info({
			service: SERVICE_NAME,
			message: `Migration completed. Updated ${result.modifiedCount} monitors.`,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({ service: SERVICE_NAME, message: `Migration failed: ${errorMessage}` });
		throw error;
	}
}
