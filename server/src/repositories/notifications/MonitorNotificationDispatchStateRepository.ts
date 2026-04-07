import mongoose from "mongoose";
import { MonitorNotificationDispatchStateModel, type MonitorNotificationDispatchStateDocument } from "@/db/models/index.js";
import type { MonitorNotificationDispatchState } from "@/types/monitorNotificationDispatchState.js";

class MonitorNotificationDispatchStateRepository {
	private toEntity = (doc: MonitorNotificationDispatchStateDocument): MonitorNotificationDispatchState => {
		const toStringId = (value: mongoose.Types.ObjectId | string): string => {
			return value instanceof mongoose.Types.ObjectId ? value.toString() : value;
		};

		const toDateString = (value: Date): string => value.toISOString();

		return {
			id: toStringId(doc._id),
			userId: toStringId(doc.userId),
			teamId: toStringId(doc.teamId),
			monitorId: toStringId(doc.monitorId),
			notificationId: toStringId(doc.notificationId),
			lastSentAt: doc.lastSentAt ? toDateString(doc.lastSentAt) : null,
			createdAt: toDateString(doc.createdAt),
			updatedAt: toDateString(doc.updatedAt),
		};
	};

	findByMonitorAndNotification = async (
		teamId: string,
		monitorId: string,
		notificationId: string
	): Promise<MonitorNotificationDispatchState | null> => {
		const doc = await MonitorNotificationDispatchStateModel.findOne({
			teamId: new mongoose.Types.ObjectId(teamId),
			monitorId: new mongoose.Types.ObjectId(monitorId),
			notificationId: new mongoose.Types.ObjectId(notificationId),
		});

		return doc ? this.toEntity(doc) : null;
	};

	upsertLastSentAt = async (
		userId: string,
		teamId: string,
		monitorId: string,
		notificationId: string,
		sentAt: Date
	): Promise<MonitorNotificationDispatchState> => {
		const doc = await MonitorNotificationDispatchStateModel.findOneAndUpdate(
			{
				teamId: new mongoose.Types.ObjectId(teamId),
				monitorId: new mongoose.Types.ObjectId(monitorId),
				notificationId: new mongoose.Types.ObjectId(notificationId),
			},
			{
				$set: {
					userId: new mongoose.Types.ObjectId(userId),
					lastSentAt: sentAt,
				},
			},
			{ new: true, upsert: true, runValidators: true }
		);

		return this.toEntity(doc);
	};

	clearByMonitor = async (teamId: string, monitorId: string): Promise<number> => {
		const result = await MonitorNotificationDispatchStateModel.deleteMany({
			teamId: new mongoose.Types.ObjectId(teamId),
			monitorId: new mongoose.Types.ObjectId(monitorId),
		});
		return result.deletedCount ?? 0;
	};
}

export default MonitorNotificationDispatchStateRepository;
