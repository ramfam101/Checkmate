import type { EscalationHistory, TriggeredRule } from "@/types/index.js";
import { type EscalationHistoryDocument, type TriggeredRuleDocument, EscalationHistoryModel } from "@/db/models/index.js";
import { IEscalationHistoryRepository } from "./IEscalationHistoryRepository.js";
import mongoose from "mongoose";
import { AppError } from "@/utils/AppError.js";

class MongoEscalationHistoryRepository implements IEscalationHistoryRepository {
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

	private triggeredRuleToEntity = (doc: TriggeredRuleDocument): TriggeredRule => {
		return {
			id: this.toStringId(doc._id),
			level: doc.level,
			ruleId: this.toStringId(doc.ruleId),
			notificationIds: doc.notificationIds.map((id) => this.toStringId(id)),
			sentAt: this.toDateString(doc.sentAt),
			status: doc.status,
		};
	};

	private toEntity = (doc: EscalationHistoryDocument): EscalationHistory => {
		return {
			id: this.toStringId(doc._id),
			incidentId: this.toStringId(doc.incidentId),
			monitorId: this.toStringId(doc.monitorId),
			teamId: this.toStringId(doc.teamId),
			escalationPolicyId: this.toStringId(doc.escalationPolicyId),
			triggeredRules: doc.triggeredRules.map((r) => this.triggeredRuleToEntity(r)),
			createdAt: this.toDateString(doc.createdAt),
			updatedAt: this.toDateString(doc.updatedAt),
		};
	};

	create = async (data: Partial<EscalationHistory>): Promise<EscalationHistory> => {
		const history = await EscalationHistoryModel.create(data);
		return this.toEntity(history);
	};

	findById = async (id: string): Promise<EscalationHistory> => {
		const history = await EscalationHistoryModel.findById(id);
		if (!history) {
			throw new AppError({ message: `Escalation history not found`, status: 404 });
		}
		return this.toEntity(history);
	};

	findByIncidentId = async (incidentId: string): Promise<EscalationHistory | null> => {
		const history = await EscalationHistoryModel.findOne({ incidentId: new mongoose.Types.ObjectId(incidentId) });
		return history ? this.toEntity(history) : null;
	};

	findByTeamId = async (teamId: string): Promise<EscalationHistory[]> => {
		const histories = await EscalationHistoryModel.find({ teamId: new mongoose.Types.ObjectId(teamId) }).sort({ createdAt: -1 });
		return histories.map((h) => this.toEntity(h));
	};

	updateById = async (id: string, data: Partial<EscalationHistory>): Promise<EscalationHistory> => {
		const updated = await EscalationHistoryModel.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
		if (!updated) {
			throw new AppError({ message: `Escalation history not found`, status: 404 });
		}
		return this.toEntity(updated);
	};

	deleteByIncidentId = async (incidentId: string): Promise<number> => {
		const result = await EscalationHistoryModel.deleteMany({ incidentId: new mongoose.Types.ObjectId(incidentId) });
		return result.deletedCount;
	};
}

export default MongoEscalationHistoryRepository;
