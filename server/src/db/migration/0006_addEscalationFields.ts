import mongoose from "mongoose";
import { logger } from "@/utils/logger.js";
import MonitorModel from "../models/Monitor.js";

export async function addEscalationFields(): Promise<void> {
	const SERVICE_NAME = "Migration:AddEscalationFields";

	try {
		logger.info({ service: SERVICE_NAME, message: "Starting migration to add escalation fields to monitors" });

		const db = mongoose.connection.db;
		if (!db) {
			throw new Error("Database connection is not initialized");
		}

		// Add escalation fields to existing monitors
		const result = await MonitorModel.updateMany(
			{
				escalationEnabled: { $exists: false },
			},
			{
				$set: {
					escalationEnabled: false,
					escalationDelay: 15,
					escalationNotifications: [],
				},
			}
		);

		logger.info({
			service: SERVICE_NAME,
			message: `Migration complete. Added escalation fields to ${result.modifiedCount} monitor document(s)`,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error({ service: SERVICE_NAME, message: `Error during escalation fields migration: ${errorMessage}` });
		throw error;
	}
}