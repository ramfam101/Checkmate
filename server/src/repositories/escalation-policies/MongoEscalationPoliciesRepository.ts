import type { EscalationPolicy, EscalationRule } from "@/types/index.js";
import { type EscalationPolicyDocument, type EscalationRuleDocument, EscalationPolicyModel } from "@/db/models/index.js";
import { IEscalationPoliciesRepository } from "./IEscalationPoliciesRepository.js";
import mongoose from "mongoose";
import { AppError } from "@/utils/AppError.js";

class MongoEscalationPoliciesRepository implements IEscalationPoliciesRepository {
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

	private ruleToEntity = (doc: EscalationRuleDocument): EscalationRule => {
		return {
			id: this.toStringId(doc._id),
			level: doc.level,
			durationMinutes: doc.durationMinutes,
			notificationIds: doc.notificationIds.map((id) => this.toStringId(id)),
			message: doc.message ?? null,
		};
	};

	private toEntity = (doc: EscalationPolicyDocument): EscalationPolicy => {
		return {
			id: this.toStringId(doc._id),
			teamId: this.toStringId(doc.teamId),
			monitorId: doc.monitorId ? this.toStringId(doc.monitorId) : null,
			name: doc.name,
			isActive: doc.isActive,
			escalationRules: doc.escalationRules.map((rule) => this.ruleToEntity(rule)),
			createdAt: this.toDateString(doc.createdAt),
			updatedAt: this.toDateString(doc.updatedAt),
		};
	};

	create = async (data: Partial<EscalationPolicy>): Promise<EscalationPolicy> => {
		const policy = await EscalationPolicyModel.create(data);
		return this.toEntity(policy);
	};

	findById = async (id: string, teamId: string): Promise<EscalationPolicy> => {
		const policy = await EscalationPolicyModel.findOne({ _id: id, teamId });
		if (!policy) {
			throw new AppError({ message: `Escalation policy not found`, status: 404 });
		}
		return this.toEntity(policy);
	};

	findByTeamId = async (teamId: string): Promise<EscalationPolicy[]> => {
		const policies = await EscalationPolicyModel.find({ teamId }).sort({ createdAt: -1 });
		return policies.map((p) => this.toEntity(p));
	};

	findActiveByMonitorId = async (monitorId: string, teamId: string): Promise<EscalationPolicy | null> => {
		const policy = await EscalationPolicyModel.findOne({
			monitorId: new mongoose.Types.ObjectId(monitorId),
			teamId: new mongoose.Types.ObjectId(teamId),
			isActive: true,
		});
		return policy ? this.toEntity(policy) : null;
	};

	findActiveTeamWide = async (teamId: string): Promise<EscalationPolicy | null> => {
		const policy = await EscalationPolicyModel.findOne({
			teamId: new mongoose.Types.ObjectId(teamId),
			monitorId: null,
			isActive: true,
		});
		return policy ? this.toEntity(policy) : null;
	};

	updateById = async (id: string, teamId: string, data: Partial<EscalationPolicy>): Promise<EscalationPolicy> => {
		const updated = await EscalationPolicyModel.findOneAndUpdate({ _id: id, teamId }, { $set: data }, { new: true, runValidators: true });
		if (!updated) {
			throw new AppError({ message: `Escalation policy not found`, status: 404 });
		}
		return this.toEntity(updated);
	};

	deleteById = async (id: string, teamId: string): Promise<EscalationPolicy> => {
		const deleted = await EscalationPolicyModel.findOneAndDelete({ _id: id, teamId });
		if (!deleted) {
			throw new AppError({ message: `Escalation policy not found`, status: 404 });
		}
		return this.toEntity(deleted);
	};
}

export default MongoEscalationPoliciesRepository;
