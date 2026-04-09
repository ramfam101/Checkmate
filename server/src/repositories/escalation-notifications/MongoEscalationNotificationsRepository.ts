import { EscalationNotificationModel } from "@/db/models/index.js";
import type { EscalationNotificationDocument } from "@/db/models/EscalationNotification.js";
import type { EscalationNotification } from "@/types/index.js";
import type { IEscalationNotificationsRepository } from "@/repositories/index.js";
import mongoose from "mongoose";
import { AppError } from "@/utils/AppError.js";

class MongoEscalationNotificationsRepository implements IEscalationNotificationsRepository {
	private toStringId = (value?: mongoose.Types.ObjectId | string | null): string => {
		if (!value) {
			return "";
		}
		return value instanceof mongoose.Types.ObjectId ? value.toString() : String(value);
	};

	private toDateString = (value?: Date | string | null): string => {
		if (!value) {
			return new Date(0).toISOString();
		}
		return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
	};

	protected toEntity = (doc: EscalationNotificationDocument): EscalationNotification => {
		return {
			id: this.toStringId(doc._id),
			monitorId: this.toStringId(doc.monitorId),
			escalationLevel: doc.escalationLevel,
			delaySeconds: doc.delaySeconds,
			notificationChannel: doc.notificationChannel,
			isActive: doc.isActive,
			createdAt: this.toDateString(doc.createdAt),
			updatedAt: this.toDateString(doc.updatedAt),
		};
	};

	protected mapDocuments = (documents: EscalationNotificationDocument[] | EscalationNotificationDocument | null): EscalationNotification[] => {
		if (!documents) {
			return [];
		}
		if (Array.isArray(documents)) {
			return documents.map((doc) => this.toEntity(doc));
		}
		return [this.toEntity(documents)];
	};

	async create(escalationData: Partial<EscalationNotification>): Promise<EscalationNotification> {
		const newEscalation = await EscalationNotificationModel.create(escalationData);
		return this.toEntity(newEscalation);
	}

	findById = async (id: string): Promise<EscalationNotification> => {
		const escalation = await EscalationNotificationModel.findById(id);
		if (!escalation) {
			throw new AppError({ message: `Escalation notification with id ${id} not found`, status: 404 });
		}
		return this.toEntity(escalation);
	};

	findByMonitorId = async (monitorId: string): Promise<EscalationNotification[]> => {
		const escalations = await EscalationNotificationModel.find({
			monitorId: new mongoose.Types.ObjectId(monitorId),
		}).sort({ escalationLevel: 1, delaySeconds: 1 });
		return this.mapDocuments(escalations);
	};

	findActiveByMonitorId = async (monitorId: string): Promise<EscalationNotification[]> => {
		const escalations = await EscalationNotificationModel.find({
			monitorId: new mongoose.Types.ObjectId(monitorId),
			isActive: true,
		}).sort({ escalationLevel: 1, delaySeconds: 1 });
		return this.mapDocuments(escalations);
	};

	findAllActive = async (): Promise<EscalationNotification[]> => {
		const escalations = await EscalationNotificationModel.find({ isActive: true });
		return this.mapDocuments(escalations);
	};

	updateById = async (id: string, updateData: Partial<EscalationNotification>): Promise<EscalationNotification> => {
		const updatedEscalation = await EscalationNotificationModel.findByIdAndUpdate(
			id,
			{ $set: updateData },
			{ new: true, runValidators: true }
		);
		if (!updatedEscalation) {
			throw new AppError({ message: `Failed to update escalation notification with id ${id}`, status: 500 });
		}
		return this.toEntity(updatedEscalation);
	};

	deleteById = async (id: string): Promise<EscalationNotification> => {
		const deletedEscalation = await EscalationNotificationModel.findByIdAndDelete(id);
		if (!deletedEscalation) {
			throw new AppError({ message: `Escalation notification with id ${id} not found`, status: 404 });
		}
		return this.toEntity(deletedEscalation);
	};

	deleteByMonitorId = async (monitorId: string): Promise<number> => {
		const result = await EscalationNotificationModel.deleteMany({
			monitorId: new mongoose.Types.ObjectId(monitorId),
		});
		return result.deletedCount || 0;
	};
}

export default MongoEscalationNotificationsRepository;