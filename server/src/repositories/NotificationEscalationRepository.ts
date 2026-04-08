import { NotificationEscalationModel, type NotificationEscalationDocument } from "@/db/models/NotificationEscalation.js";
import { AppError } from "@/utils/AppError.js";
import type { ILogger } from "@/utils/logger.js";

export interface NotificationEscalation {
	id: string;
	incidentId: string;
	notificationId: string;
	monitorId: string;
	teamId: string;
	delayMinutes: number;
	escalatedAt?: Date | null;
	status: "pending" | "escalated" | "resolved";
	createdAt: Date;
	updatedAt: Date;
}

export interface INotificationEscalationRepository {
	create(data: Partial<NotificationEscalation>): Promise<NotificationEscalation>;
	findByIncidentId(incidentId: string): Promise<NotificationEscalation[]>;
	findPendingEscalations(): Promise<NotificationEscalation[]>;
	updateStatus(id: string, status: "pending" | "escalated" | "resolved"): Promise<NotificationEscalation>;
	markEscalated(id: string): Promise<NotificationEscalation>;
	deleteByIncidentId(incidentId: string): Promise<number>;
}

export class MongoNotificationEscalationRepository implements INotificationEscalationRepository {
	private logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	async create(data: Partial<NotificationEscalation>): Promise<NotificationEscalation> {
		try {
			const escalation = new NotificationEscalationModel(data);
			const saved = await escalation.save();
			return this.mapToEscalation(saved);
		} catch (error: unknown) {
			this.logger.error({
				service: "NotificationEscalationRepository",
				method: "create",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async findByIncidentId(incidentId: string): Promise<NotificationEscalation[]> {
		try {
			const escalations = await NotificationEscalationModel.find({ incidentId });
			return escalations.map((e) => this.mapToEscalation(e));
		} catch (error: unknown) {
			this.logger.error({
				service: "NotificationEscalationRepository",
				method: "findByIncidentId",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async findPendingEscalations(): Promise<NotificationEscalation[]> {
		try {
			const escalations = await NotificationEscalationModel.find({ status: "pending" });
			return escalations.map((e) => this.mapToEscalation(e));
		} catch (error: unknown) {
			this.logger.error({
				service: "NotificationEscalationRepository",
				method: "findPendingEscalations",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async updateStatus(id: string, status: "pending" | "escalated" | "resolved"): Promise<NotificationEscalation> {
		try {
			const escalation = await NotificationEscalationModel.findByIdAndUpdate(id, { status }, { new: true });
			if (!escalation) {
				throw new AppError({ message: "Escalation not found", status: 404 });
			}
			return this.mapToEscalation(escalation);
		} catch (error: unknown) {
			this.logger.error({
				service: "NotificationEscalationRepository",
				method: "updateStatus",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async markEscalated(id: string): Promise<NotificationEscalation> {
		try {
			const escalation = await NotificationEscalationModel.findByIdAndUpdate(id, { status: "escalated", escalatedAt: new Date() }, { new: true });
			if (!escalation) {
				throw new AppError({ message: "Escalation not found", status: 404 });
			}
			return this.mapToEscalation(escalation);
		} catch (error: unknown) {
			this.logger.error({
				service: "NotificationEscalationRepository",
				method: "markEscalated",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	async deleteByIncidentId(incidentId: string): Promise<number> {
		try {
			const result = await NotificationEscalationModel.deleteMany({ incidentId });
			return result.deletedCount;
		} catch (error: unknown) {
			this.logger.error({
				service: "NotificationEscalationRepository",
				method: "deleteByIncidentId",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		}
	}

	private mapToEscalation(doc: NotificationEscalationDocument): NotificationEscalation {
		return {
			id: doc._id.toString(),
			incidentId: doc.incidentId.toString(),
			notificationId: doc.notificationId.toString(),
			monitorId: doc.monitorId.toString(),
			teamId: doc.teamId.toString(),
			delayMinutes: doc.delayMinutes,
			escalatedAt: doc.escalatedAt,
			status: doc.status,
			createdAt: doc.createdAt,
			updatedAt: doc.updatedAt,
		};
	}
}
