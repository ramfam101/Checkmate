import Monitor from "@/db/models/Monitor.js";
import { normalizeNotificationEscalations } from "@/utils/normalizeNotificationEscalations.js";

export default async function migrate() {
	const monitors = await Monitor.find({ notificationEscalations: { $exists: true } }, { _id: 1, notificationEscalations: 1 }).lean();

	for (const monitor of monitors) {
		const normalized = normalizeNotificationEscalations((monitor as any).notificationEscalations);
		await Monitor.updateOne(
			{ _id: monitor._id },
			{
				$set: {
					notificationEscalations: normalized.length
						? {
								notificationIds: normalized.map((rule) => rule.notificationId),
								delayMinutes: normalized[0]?.delayMinutes ?? 0,
						  }
						: undefined,
				},
			}
		);
	}
}