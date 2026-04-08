import type { NotificationEscalationTracker } from "@/types/escalation.js";
import mongoose from "mongoose";
import { AppError } from "@/utils/AppError.js";

/**
 * WHAT: This talks to MongoDB database using Mongoose
 * WHY: We need to save/load escalation state
 */

export interface IEscalationRepository {
	create(tracker: NotificationEscalationTracker): Promise<NotificationEscalationTracker>;
	findByIncident(incidentId: string): Promise<NotificationEscalationTracker[]>;
	findByIncidentAndRule(
		incidentId: string,
		ruleId: string
	): Promise<NotificationEscalationTracker | null>;
	updateById(
		id: string,
		teamId: string,
		updates: Partial<NotificationEscalationTracker>
	): Promise<NotificationEscalationTracker>;
	deleteByIncident(incidentId: string): Promise<number>;
}

// Import the model
import { EscalationTrackerModel } from "@/db/models/index.js";

class MongoEscalationRepository implements IEscalationRepository {
	private toStringId = (value?: mongoose.Types.ObjectId | string | null): string => {
		if (!value) {
			return "";
		}
		return value instanceof mongoose.Types.ObjectId ? value.toString() : String(value);
	};

	private toEntity = (doc: any): NotificationEscalationTracker => {
		return {
			id: this.toStringId(doc._id),
			incidentId: this.toStringId(doc.incidentId),
			monitorId: this.toStringId(doc.monitorId),
			teamId: this.toStringId(doc.teamId),
			escalationRuleId: doc.escalationRuleId,
			primaryNotificationId: this.toStringId(doc.primaryNotificationId),
			escalationNotificationId: this.toStringId(doc.escalationNotificationId),
			delayMinutes: doc.delayMinutes,
			createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
			escalatedAt: doc.escalatedAt ? doc.escalatedAt.toISOString() : undefined,
			acknowledgedAt: doc.acknowledgedAt ? doc.acknowledgedAt.toISOString() : undefined,
			isEscalated: doc.isEscalated || false,
		};
	};

	async create(tracker: NotificationEscalationTracker): Promise<NotificationEscalationTracker> {
		try {
			const newTracker = await EscalationTrackerModel.create({
				incidentId: new mongoose.Types.ObjectId(tracker.incidentId),
				monitorId: new mongoose.Types.ObjectId(tracker.monitorId),
				teamId: new mongoose.Types.ObjectId(tracker.teamId),
				escalationRuleId: tracker.escalationRuleId,
				primaryNotificationId: new mongoose.Types.ObjectId(tracker.primaryNotificationId),
				escalationNotificationId: new mongoose.Types.ObjectId(tracker.escalationNotificationId),
				delayMinutes: tracker.delayMinutes,
				createdAt: new Date(tracker.createdAt),
				isEscalated: false,
			});
			return this.toEntity(newTracker);
		} catch (error: unknown) {
			throw new AppError({
				message: "Failed to create escalation tracker",
				status: 500,
			});
		}
	}

	async findByIncident(incidentId: string): Promise<NotificationEscalationTracker[]> {
		try {
			const trackers = await EscalationTrackerModel.find({
				incidentId: new mongoose.Types.ObjectId(incidentId),
			});
			return trackers.map((tracker) => this.toEntity(tracker));
		} catch (error: unknown) {
			throw new AppError({
				message: "Failed to find escalation trackers",
				status: 500,
			});
		}
	}

	async findByIncidentAndRule(
		incidentId: string,
		ruleId: string
	): Promise<NotificationEscalationTracker | null> {
		try {
			const tracker = await EscalationTrackerModel.findOne({
				incidentId: new mongoose.Types.ObjectId(incidentId),
				escalationRuleId: ruleId,
			});
			return tracker ? this.toEntity(tracker) : null;
		} catch (error: unknown) {
			throw new AppError({
				message: "Failed to find escalation tracker",
				status: 500,
			});
		}
	}

	async updateById(
		id: string,
		teamId: string,
		updates: Partial<NotificationEscalationTracker>
	): Promise<NotificationEscalationTracker> {
		try {
			const updateData: any = { ...updates };

			// Convert date strings back to Date objects if needed
			if (updates.escalatedAt) {
				updateData.escalatedAt = new Date(updates.escalatedAt);
			}
			if (updates.acknowledgedAt) {
				updateData.acknowledgedAt = new Date(updates.acknowledgedAt);
			}

			const updated = await EscalationTrackerModel.findOneAndUpdate(
				{
					_id: new mongoose.Types.ObjectId(id),
					teamId: new mongoose.Types.ObjectId(teamId),
				},
				{ $set: updateData },
				{ new: true, runValidators: true }
			);

			if (!updated) {
				throw new AppError({
					message: `Failed to update escalation tracker with id ${id}`,
					status: 404,
				});
			}

			return this.toEntity(updated);
		} catch (error: unknown) {
			throw new AppError({
				message: "Failed to update escalation tracker",
				status: 500,
			});
		}
	}

	async deleteByIncident(incidentId: string): Promise<number> {
		try {
			const result = await EscalationTrackerModel.deleteMany({
				incidentId: new mongoose.Types.ObjectId(incidentId),
			});
			return result.deletedCount || 0;
		} catch (error: unknown) {
			throw new AppError({
				message: "Failed to delete escalation trackers",
				status: 500,
			});
		}
	}
}

export default MongoEscalationRepository;