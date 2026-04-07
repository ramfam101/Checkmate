import mongoose from "mongoose";
import { logger } from "@/utils/logger.js";
import IncidentModel from "../models/Incident.js";

export async function addEscalationsSentToIncidents(): Promise<void> {
	const SERVICE_NAME = "Migration:AddEscalationsSentToIncidents";

	try {
		logger.info({ service: SERVICE_NAME, message: "Starting migration to add escalationsSent field to existing incidents" });

		const db = mongoose.connection.db;
		if (!db) {
			throw new Error("Database connection is not initialized");
		}

		const result = await IncidentModel.updateMany(
			{
				escalationsSent: { $exists: false }
			},
			{
				$set: {
					escalationsSent: []
				}
			}
		);

		if (result.modifiedCount === 0) {
			logger.info({ service: SERVICE_NAME, message: "No Incident documents needed migration" });
			return;
		}

		logger.info({
			service: SERVICE_NAME,
			message: `Migration complete. Added escalationsSent field to ${result.modifiedCount} Incident document(s)`
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({ service: SERVICE_NAME, message: `Error during Incident escalationsSent migration: ${errorMessage}` });
		throw error;
	}
}