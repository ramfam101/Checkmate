import type { EscalationDocument, EscalationModel } from "@/db/models/Escalation.js";
import type { IEscalationsRepository } from "./IEscalationsRepository.js";
import { AppError } from "@/utils/AppError.js";

const SERVICE_NAME = "MongoEscalationsRepository";

export class MongoEscalationsRepository implements IEscalationsRepository {
	static SERVICE_NAME = SERVICE_NAME;

	private escalationModel: typeof EscalationModel;

	constructor(escalationModel: typeof EscalationModel) {
		this.escalationModel = escalationModel;
	}

	create = async (escalationData: Omit<EscalationDocument, "_id" | "createdAt" | "updatedAt">): Promise<EscalationDocument> => {
		try {
			const escalation = new this.escalationModel(escalationData);
			return await escalation.save();
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to create escalation: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "create",
			});
		}
	};

	findById = async (id: string): Promise<EscalationDocument | null> => {
		try {
			return await this.escalationModel.findById(id);
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to find escalation by id: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "findById",
			});
		}
	};

	findByIncidentId = async (incidentId: string, teamId: string): Promise<EscalationDocument[]> => {
		try {
			return await this.escalationModel.find({ incidentId, teamId }).sort({ delayMinutes: 1 });
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to find escalations by incident: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "findByIncidentId",
			});
		}
	};

	findByIncidentAndNotification = async (incidentId: string, notificationId: string, teamId: string): Promise<EscalationDocument[]> => {
		try {
			return await this.escalationModel.find({ incidentId, notificationId, teamId }).sort({ delayMinutes: 1 });
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to find escalations by incident and notification: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "findByIncidentAndNotification",
			});
		}
	};

	findPendingEscalations = async (currentTime: Date): Promise<EscalationDocument[]> => {
		try {
			// Find escalations where (createdAt + delayMinutes) <= currentTime and sentAt is null
			return await this.escalationModel.find({
				sentAt: null,
				$expr: {
					$lte: [
						{ $add: ["$createdAt", { $multiply: ["$delayMinutes", 60 * 1000] }] },
						currentTime
					]
				}
			});
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to find pending escalations: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "findPendingEscalations",
			});
		}
	};

	markAsSent = async (id: string, teamId: string): Promise<EscalationDocument> => {
		try {
			const escalation = await this.escalationModel.findOneAndUpdate(
				{ _id: id, teamId },
				{ sentAt: new Date() },
				{ new: true }
			);
			if (!escalation) {
				throw new Error("Escalation not found");
			}
			return escalation;
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to mark escalation as sent: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "markAsSent",
			});
		}
	};

	deleteByIncidentId = async (incidentId: string, teamId: string): Promise<void> => {
		try {
			await this.escalationModel.deleteMany({ incidentId, teamId });
		} catch (error: unknown) {
			throw new AppError({
				message: `Failed to delete escalations by incident: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "deleteByIncidentId",
			});
		}
	};
}