import mongoose from "mongoose";

export async function migrateNotificationsToObjects(): Promise<void> {
	const db = mongoose.connection.db;
	if (!db) {
		throw new Error("Database connection is not initialized");
	}

	const monitorsToMigrate = await db
		.collection("monitors")
		.find({ "notifications.0": { $type: "objectId" } })
		.toArray();

	if (monitorsToMigrate.length === 0) {
		return;
	}

	for (const monitor of monitorsToMigrate) {
		const newNotifications = (monitor.notifications as mongoose.Types.ObjectId[]).map((id) => ({
			notificationId: id,
			escalations: [],
		}));

		await db.collection("monitors").updateOne({ _id: monitor._id }, { $set: { notifications: newNotifications } });
	}
}
