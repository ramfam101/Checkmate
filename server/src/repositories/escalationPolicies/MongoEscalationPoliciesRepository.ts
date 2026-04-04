import mongoose from "mongoose";
import type { EscalationPolicy } from "@/types/notification.js";
import { EscalationPolicyModel } from "@/db/models/EscalationPolicy.js";
import { AppError } from "@/utils/AppError.js";

export interface IEscalationPoliciesRepository {
	findById(policyId: string, teamId: string): Promise<EscalationPolicy | null>;
	findByTeamId(teamId: string): Promise<EscalationPolicy[]>;
	create(policy: Partial<EscalationPolicy>, teamId: string): Promise<EscalationPolicy>;
	updateById(policyId: string, teamId: string, updateData: Partial<EscalationPolicy>): Promise<EscalationPolicy>;
	deleteById(policyId: string, teamId: string): Promise<void>;
	findEnabledByTeamId(teamId: string): Promise<EscalationPolicy[]>;
}

export class MongoEscalationPoliciesRepository implements IEscalationPoliciesRepository {
	private toStringId = (id: mongoose.Types.ObjectId): string => id.toString();

	private toEntity = (doc: any): EscalationPolicy => {
		return {
			id: this.toStringId(doc._id),
			teamId: this.toStringId(doc.teamId),
			name: doc.name,
			description: doc.description,
			rules: doc.rules || [],
			enabled: doc.enabled,
			createdAt: doc.createdAt.toISOString ? doc.createdAt.toISOString() : doc.createdAt,
			updatedAt: doc.updatedAt.toISOString ? doc.updatedAt.toISOString() : doc.updatedAt,
		};
	};

	findById = async (policyId: string, teamId: string): Promise<EscalationPolicy | null> => {
		const policy = await EscalationPolicyModel.findOne({
			_id: new mongoose.Types.ObjectId(policyId),
			teamId: new mongoose.Types.ObjectId(teamId),
		});
		return policy ? this.toEntity(policy) : null;
	};

	findByTeamId = async (teamId: string): Promise<EscalationPolicy[]> => {
		const policies = await EscalationPolicyModel.find({
			teamId: new mongoose.Types.ObjectId(teamId),
		}).sort({ createdAt: -1 });
		return policies.map((p) => this.toEntity(p));
	};

	findEnabledByTeamId = async (teamId: string): Promise<EscalationPolicy[]> => {
		const policies = await EscalationPolicyModel.find({
			teamId: new mongoose.Types.ObjectId(teamId),
			enabled: true,
		}).sort({ createdAt: -1 });
		return policies.map((p) => this.toEntity(p));
	};

	create = async (policy: Partial<EscalationPolicy>, teamId: string): Promise<EscalationPolicy> => {
		const newPolicy = await EscalationPolicyModel.create({
			...policy,
			teamId: new mongoose.Types.ObjectId(teamId),
		});
		return this.toEntity(newPolicy);
	};

	updateById = async (policyId: string, teamId: string, updateData: Partial<EscalationPolicy>): Promise<EscalationPolicy> => {
		const policy = await EscalationPolicyModel.findOneAndUpdate(
			{
				_id: new mongoose.Types.ObjectId(policyId),
				teamId: new mongoose.Types.ObjectId(teamId),
			},
			updateData,
			{ new: true }
		);

		if (!policy) {
			throw new AppError({
				message: "Escalation policy not found",
				status: 404,
				service: "EscalationPoliciesRepository",
				method: "updateById",
			});
		}

		return this.toEntity(policy);
	};

	deleteById = async (policyId: string, teamId: string): Promise<void> => {
		const result = await EscalationPolicyModel.deleteOne({
			_id: new mongoose.Types.ObjectId(policyId),
			teamId: new mongoose.Types.ObjectId(teamId),
		});

		if (result.deletedCount === 0) {
			throw new AppError({
				message: "Escalation policy not found",
				status: 404,
				service: "EscalationPoliciesRepository",
				method: "deleteById",
			});
		}
	};
}
