import type { EscalationPolicy, EscalationHistory, EscalationRule, TriggeredRule } from "@/types/escalation.js";
import type { Incident } from "@/types/incident.js";
import type { IEscalationPoliciesRepository } from "@/repositories/escalation-policies/IEscalationPoliciesRepository.js";
import type { IEscalationHistoryRepository } from "@/repositories/escalation-history/IEscalationHistoryRepository.js";
import type { IIncidentsRepository } from "@/repositories/index.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ILogger } from "@/utils/logger.js";
import { AppError } from "@/utils/AppError.js";

const SERVICE_NAME = "EscalationService";

export interface IEscalationService {
	createEscalationPolicy(data: Partial<EscalationPolicy>): Promise<EscalationPolicy>;
	getEscalationPoliciesByTeam(teamId: string): Promise<EscalationPolicy[]>;
	getEscalationPolicyById(id: string, teamId: string): Promise<EscalationPolicy>;
	getEscalationPolicyByMonitorId(monitorId: string, teamId: string): Promise<EscalationPolicy | null>;
	updateEscalationPolicy(id: string, teamId: string, data: Partial<EscalationPolicy>): Promise<EscalationPolicy>;
	deleteEscalationPolicy(id: string, teamId: string): Promise<EscalationPolicy>;
	assignPolicyToIncident(incidentId: string, teamId: string, monitorId: string): Promise<Incident | null>;
	evaluateIncidentEscalations(): Promise<void>;
	getEscalationHistoryByIncident(incidentId: string): Promise<EscalationHistory | null>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private escalationPoliciesRepository: IEscalationPoliciesRepository;
	private escalationHistoryRepository: IEscalationHistoryRepository;
	private incidentsRepository: IIncidentsRepository;
	private notificationsService: INotificationsService;
	private logger: ILogger;

	constructor(
		escalationPoliciesRepository: IEscalationPoliciesRepository,
		escalationHistoryRepository: IEscalationHistoryRepository,
		incidentsRepository: IIncidentsRepository,
		notificationsService: INotificationsService,
		logger: ILogger
	) {
		this.escalationPoliciesRepository = escalationPoliciesRepository;
		this.escalationHistoryRepository = escalationHistoryRepository;
		this.incidentsRepository = incidentsRepository;
		this.notificationsService = notificationsService;
		this.logger = logger;
	}

	get serviceName() {
		return EscalationService.SERVICE_NAME;
	}

	createEscalationPolicy = async (data: Partial<EscalationPolicy>): Promise<EscalationPolicy> => {
		if (!data.teamId) {
			throw new AppError({ message: "teamId is required", status: 400, service: SERVICE_NAME });
		}
		if (!data.name || data.name.trim() === "") {
			throw new AppError({ message: "name is required", status: 400, service: SERVICE_NAME });
		}
		if (!data.escalationRules || data.escalationRules.length === 0) {
			throw new AppError({ message: "At least one escalation rule is required", status: 400, service: SERVICE_NAME });
		}
		// Ensure levels are unique and sorted
		const levels = data.escalationRules.map((r) => r.level);
		const uniqueLevels = new Set(levels);
		if (uniqueLevels.size !== levels.length) {
			throw new AppError({ message: "Escalation rule levels must be unique", status: 400, service: SERVICE_NAME });
		}
		data.escalationRules = [...data.escalationRules].sort((a, b) => a.level - b.level);
		return await this.escalationPoliciesRepository.create(data);
	};

	getEscalationPoliciesByTeam = async (teamId: string): Promise<EscalationPolicy[]> => {
		return await this.escalationPoliciesRepository.findByTeamId(teamId);
	};

	getEscalationPolicyById = async (id: string, teamId: string): Promise<EscalationPolicy> => {
		return await this.escalationPoliciesRepository.findById(id, teamId);
	};

	getEscalationPolicyByMonitorId = async (monitorId: string, teamId: string): Promise<EscalationPolicy | null> => {
		return await this.escalationPoliciesRepository.findActiveByMonitorId(monitorId, teamId);
	};

	updateEscalationPolicy = async (id: string, teamId: string, data: Partial<EscalationPolicy>): Promise<EscalationPolicy> => {
		if (data.escalationRules) {
			const levels = data.escalationRules.map((r) => r.level);
			const uniqueLevels = new Set(levels);
			if (uniqueLevels.size !== levels.length) {
				throw new AppError({ message: "Escalation rule levels must be unique", status: 400, service: SERVICE_NAME });
			}
			data.escalationRules = [...data.escalationRules].sort((a, b) => a.level - b.level);
		}
		return await this.escalationPoliciesRepository.updateById(id, teamId, data);
	};

	deleteEscalationPolicy = async (id: string, teamId: string): Promise<EscalationPolicy> => {
		return await this.escalationPoliciesRepository.deleteById(id, teamId);
	};

	/**
	 * Find and assign the most applicable escalation policy to a new incident.
	 * Monitor-specific policies take precedence over team-wide policies.
	 */
	assignPolicyToIncident = async (incidentId: string, teamId: string, monitorId: string): Promise<Incident | null> => {
		try {
			let policy: EscalationPolicy | null = await this.escalationPoliciesRepository.findActiveByMonitorId(monitorId, teamId);
			if (!policy) {
				policy = await this.escalationPoliciesRepository.findActiveTeamWide(teamId);
			}
			if (!policy || policy.escalationRules.length === 0) {
				return null;
			}

			const firstRule = policy.escalationRules[0];
			if (!firstRule) {
				return null;
			}
			const nextEscalationTime = new Date(Date.now() + firstRule.durationMinutes * 60 * 1000).toISOString();

			const updated = await this.incidentsRepository.updateById(incidentId, teamId, {
				escalationPolicyId: policy.id,
				lastEscalationLevel: 0,
				nextEscalationTime,
			} as Partial<Incident>);

			// Create escalation history record
			await this.escalationHistoryRepository.create({
				incidentId,
				monitorId,
				teamId,
				escalationPolicyId: policy.id,
				triggeredRules: [],
			} as Partial<EscalationHistory>);

			this.logger.info({
				message: `Escalation policy "${policy.name}" assigned to incident ${incidentId}`,
				service: SERVICE_NAME,
				method: "assignPolicyToIncident",
			});

			return updated;
		} catch (error) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Failed to assign escalation policy",
				service: SERVICE_NAME,
				method: "assignPolicyToIncident",
				stack: error instanceof Error ? error.stack : undefined,
			});
			return null;
		}
	};

	/**
	 * Check all active incidents and trigger escalations for those whose nextEscalationTime has passed.
	 * This is intended to be called by a background job periodically.
	 */
	evaluateIncidentEscalations = async (): Promise<void> => {
		try {
			const now = new Date();
			const activeIncidents = await this.incidentsRepository.findActiveIncidentsWithEscalation(now);

			for (const incident of activeIncidents) {
				await this.triggerEscalation(incident);
			}
		} catch (error) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Failed to evaluate incident escalations",
				service: SERVICE_NAME,
				method: "evaluateIncidentEscalations",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	/**
	 * Trigger the next escalation level for a given incident.
	 */
	private triggerEscalation = async (incident: Incident): Promise<void> => {
		if (!incident.escalationPolicyId) {
			return;
		}

		let policy: EscalationPolicy;
		try {
			policy = await this.escalationPoliciesRepository.findById(incident.escalationPolicyId, incident.teamId);
		} catch {
			this.logger.warn({
				message: `Escalation policy ${incident.escalationPolicyId} not found for incident ${incident.id}`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
			});
			return;
		}

		const currentLevel = incident.lastEscalationLevel ?? 0;
		const nextRule = policy.escalationRules.find((r) => r.level === currentLevel + 1);
		if (!nextRule) {
			// No more rules — clear nextEscalationTime
			await this.incidentsRepository.updateById(incident.id, incident.teamId, {
				nextEscalationTime: null,
			} as Partial<Incident>);
			return;
		}

		// Send notifications for this rule
		const sentAt = new Date();
		const incidentDurationMinutes = incident.startTime
			? Math.floor((Date.now() - new Date(incident.startTime).getTime()) / 60000)
			: 0;
		let status: "sent" | "failed" = "sent";
		try {
			await this.sendEscalationNotifications(nextRule, incidentDurationMinutes, policy.name);
		} catch (error) {
			status = "failed";
			this.logger.error({
				message: error instanceof Error ? error.message : `Failed to send escalation notifications for incident ${incident.id} at level ${nextRule.level}`,
				service: SERVICE_NAME,
				method: "triggerEscalation",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}

		// Determine the next rule after this one. After triggering level N (nextRule),
		// wait ruleAfterNext.durationMinutes before triggering level N+1 (ruleAfterNext).
		const ruleAfterNext = policy.escalationRules.find((r) => r.level === nextRule.level + 1);
		const nextEscalationTime = ruleAfterNext
			? new Date(Date.now() + ruleAfterNext.durationMinutes * 60 * 1000).toISOString()
			: null;

		// Update incident
		await this.incidentsRepository.updateById(incident.id, incident.teamId, {
			lastEscalationLevel: nextRule.level,
			nextEscalationTime,
		} as Partial<Incident>);

		// Record in escalation history
		await this.recordTriggeredRule(incident, nextRule, sentAt, status);

		this.logger.info({
			message: `Escalation level ${nextRule.level} triggered for incident ${incident.id}`,
			service: SERVICE_NAME,
			method: "triggerEscalation",
		});
	};

	private sendEscalationNotifications = async (rule: EscalationRule, incidentDurationMinutes: number, monitorName: string): Promise<void> => {
		if (!rule.notificationIds || rule.notificationIds.length === 0) {
			return;
		}
		await this.notificationsService.sendEscalationNotification(
			rule.notificationIds,
			rule.level,
			incidentDurationMinutes,
			monitorName
		);
	};

	private recordTriggeredRule = async (
		incident: Incident,
		rule: EscalationRule,
		sentAt: Date,
		status: "sent" | "failed"
	): Promise<void> => {
		try {
			const history = await this.escalationHistoryRepository.findByIncidentId(incident.id);
			if (!history) {
				return;
			}

			const triggeredRule: Partial<TriggeredRule> = {
				level: rule.level,
				ruleId: rule.id,
				notificationIds: rule.notificationIds,
				sentAt: sentAt.toISOString(),
				status,
			};

			const updatedTriggeredRules = [...(history.triggeredRules ?? []), triggeredRule as TriggeredRule];
			await this.escalationHistoryRepository.updateById(history.id, {
				triggeredRules: updatedTriggeredRules,
			} as Partial<EscalationHistory>);
		} catch (error) {
			this.logger.warn({
				message: error instanceof Error ? error.message : `Failed to record triggered escalation rule for incident ${incident.id}`,
				service: SERVICE_NAME,
				method: "recordTriggeredRule",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	getEscalationHistoryByIncident = async (incidentId: string): Promise<EscalationHistory | null> => {
		return await this.escalationHistoryRepository.findByIncidentId(incidentId);
	};
}
