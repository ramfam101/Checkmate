import { EscalationNotificationLogModel } from "@/db/models/index.js";
import type { IEscalationNotificationLogsRepository } from "@/repositories/index.js";
import mongoose from "mongoose";
import { AppError } from "@/utils/AppError.js";

interface EscalationNotificationLog {
	id: string;
	incidentId: string;
	escalationNotificationId: string;
	sentAt: Date;
	notificationChannel: string;
	status: "sent" | "failed";
	errorMessage?: string;
}

class MongoEscalationNotificationLogsRepository implements IEscalationNotificationLogsRepository {
	async create(logData: Omit<EscalationNotificationLog, "id">): Promise<EscalationNotificationLog> {
		const log = await EscalationNotificationLogModel.create(logData);
		return {
			id: log._id.toString(),
			incidentId: log.incidentId.toString(),
			escalationNotificationId: log.escalationNotificationId.toString(),
			sentAt: log.sentAt,
			notificationChannel: log.notificationChannel,
			status: log.status,
			errorMessage: log.errorMessage,
		};
	}

	async hasBeenSent(incidentId: string, escalationNotificationId: string): Promise<boolean> {
		const count = await EscalationNotificationLogModel.countDocuments({
			incidentId: new mongoose.Types.ObjectId(incidentId),
			escalationNotificationId: new mongoose.Types.ObjectId(escalationNotificationId),
			status: "sent",
		});
		return count > 0;
	}
}

export default MongoEscalationNotificationLogsRepository;