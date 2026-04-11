import mongoose from "mongoose";
import { MonitorModel } from "../models/Monitor.js";
import { logger } from "@/utils/logger.js";

/**
 * Repairs monitor notifications field where a stringified object was saved
 * instead of ObjectId values.
 */
export async function fixCorruptedMonitorNotifications(): Promise<void> {
	const SERVICE_NAME = "Migration:FixCorruptedMonitorNotifications";

	await MonitorModel.updateOne(
		{ _id: new mongoose.Types.ObjectId("69d6d089cd86851fff8bc9b5") },
		{ $set: { notifications: [new mongoose.Types.ObjectId("69d6d030cd86851fff8bc9ae")] } }
	);

	logger.info({
		service: SERVICE_NAME,
		message: "Patched monitor 69d6d089cd86851fff8bc9b5 notifications field",
	});
}
