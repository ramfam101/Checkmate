import mongoose from "mongoose";
import { logger } from "@/utils/logger.js";
import IncidentModel from "../models/Incident.js";

export async function addIncidentEscalationSentAt(): Promise<void> {
	const SERVICE_NAME = "Migration:AddIncidentEscalationSentAt";

	try {
		logger.info({ service: SERVICE_NAME, message: "Starting migration to add escalationSentAt to incidents" });

		const db = mongoose.connection.db;
		if (!db) {
			throw new Error("Database connection is not initialized");
		}

		const result = await IncidentModel.updateMany(
			{
				escalationSentAt: { $exists: false },
			},
			{
				$set: {
					escalationSentAt: null,
				},
			}
		);

		logger.info({
			service: SERVICE_NAME,
			message: `Migration complete. Added escalationSentAt to ${result.modifiedCount} incident document(s)`,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({ service: SERVICE_NAME, message: `Error during incident escalation migration: ${errorMessage}` });
		throw error;
	}
}
