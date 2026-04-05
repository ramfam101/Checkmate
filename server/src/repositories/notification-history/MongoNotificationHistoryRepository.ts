import mongoose from "mongoose";
import { NotificationHistoryModel, type NotificationHistoryDocument } from "@/db/models/index.js";
import { INotificationHistoryRepository } from "@/repositories/index.js";
import type { NotificationHistory } from "@/db/models/NotificationHistory.js";
import { AppError } from "@/utils/AppError.js";

class MongoNotificationHistoryRepository implements INotificationHistoryRepository {
	private toEntity = (doc: NotificationHistoryDocument): NotificationHistory => {
		const toStringId = (value: mongoose.Types.ObjectId | string): string => {
			return value instanceof mongoose.Types.ObjectId ? value.toString() : value;
		};

		return {
			id: toStringId(doc._id),
			incidentId: toStringId(doc.incidentId),
			notificationId: toStringId(doc.notificationId),
			escalationId: doc.escalationId ?? undefined,
			sentAt: doc.sentAt,
			status: doc.status,
			errorMessage: doc.errorMessage ?? undefined,
		};
	};

	private mapDocuments = (documents: NotificationHistoryDocument[]): NotificationHistory[] => {
		if (!documents?.length) {
			return [];
		}
		return documents.map((doc) => this.toEntity(doc));
	};

	create = async (historyData: Omit<NotificationHistory, "id">): Promise<NotificationHistory> => {
		const history = await NotificationHistoryModel.create({
			...historyData,
			incidentId: new mongoose.Types.ObjectId(historyData.incidentId),
			notificationId: new mongoose.Types.ObjectId(historyData.notificationId),
		});
		if (!history) {
			throw new AppError({ message: "Failed to create notification history", status: 500 });
		}
		return this.toEntity(history);
	};

	findByIncidentId = async (incidentId: string): Promise<NotificationHistory[]> => {
		const documents = await NotificationHistoryModel.find({
			incidentId: new mongoose.Types.ObjectId(incidentId),
		}).sort({ sentAt: -1 });
		return this.mapDocuments(documents);
	};

	findByIncidentAndNotification = async (incidentId: string, notificationId: string): Promise<NotificationHistory[]> => {
		const documents = await NotificationHistoryModel.find({
			incidentId: new mongoose.Types.ObjectId(incidentId),
			notificationId: new mongoose.Types.ObjectId(notificationId),
		}).sort({ sentAt: -1 });
		return this.mapDocuments(documents);
	};

	findByIncidentAndEscalation = async (incidentId: string, escalationId: string): Promise<NotificationHistory | null> => {
		const document = await NotificationHistoryModel.findOne({
			incidentId: new mongoose.Types.ObjectId(incidentId),
			escalationId: escalationId,
		}).sort({ sentAt: -1 });
		return document ? this.toEntity(document) : null;
	};

	deleteByIncidentId = async (incidentId: string): Promise<void> => {
		await NotificationHistoryModel.deleteMany({
			incidentId: new mongoose.Types.ObjectId(incidentId),
		});
	};
}

export default MongoNotificationHistoryRepository;