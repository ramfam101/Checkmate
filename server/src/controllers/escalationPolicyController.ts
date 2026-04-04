import { Request, Response, NextFunction } from "express";
import type { IEscalationPoliciesRepository } from "@/repositories/escalationPolicies/index.js";
import {
	createEscalationPolicyValidation,
	updateEscalationPolicyValidation,
	getEscalationPoliciesQueryValidation,
	getEscalationPolicyParamValidation,
	deleteEscalationPolicyParamValidation,
} from "@/validation/escalationPolicyValidation.js";
import { AppError } from "@/utils/AppError.js";
import { requireTeamId, requireUserId } from "@/controllers/controllerUtils.js";

const SERVICE_NAME = "EscalationPolicyController";

export interface IEscalationPolicyController {
	getEscalationPoliciesByTeamId: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationPolicyById: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	createEscalationPolicy: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	updateEscalationPolicy: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	deleteEscalationPolicy: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
}

class EscalationPolicyController implements IEscalationPolicyController {
	static SERVICE_NAME = SERVICE_NAME;

	private escalationPoliciesRepository: IEscalationPoliciesRepository;

	constructor(escalationPoliciesRepository: IEscalationPoliciesRepository) {
		this.escalationPoliciesRepository = escalationPoliciesRepository;
	}

	get serviceName() {
		return EscalationPolicyController.SERVICE_NAME;
	}

	getEscalationPoliciesByTeamId = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const policies = await this.escalationPoliciesRepository.findByTeamId(teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation policies retrieved successfully",
				data: policies,
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationPolicyById = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedParams = getEscalationPolicyParamValidation.parse(req.params);

			const policy = await this.escalationPoliciesRepository.findById(validatedParams.policyId, teamId);

			if (!policy) {
				throw new AppError({
					message: "Escalation policy not found",
					status: 404,
					service: SERVICE_NAME,
					method: "getEscalationPolicyById",
				});
			}

			return res.status(200).json({
				success: true,
				msg: "Escalation policy retrieved successfully",
				data: policy,
			});
		} catch (error) {
			next(error);
		}
	};

	createEscalationPolicy = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedBody = createEscalationPolicyValidation.parse(req.body);

			const policy = await this.escalationPoliciesRepository.create(validatedBody, teamId);

			return res.status(201).json({
				success: true,
				msg: "Escalation policy created successfully",
				data: policy,
			});
		} catch (error) {
			next(error);
		}
	};

	updateEscalationPolicy = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedParams = getEscalationPolicyParamValidation.parse(req.params);
			const validatedBody = updateEscalationPolicyValidation.parse(req.body);

			// Verify policy exists
			const existingPolicy = await this.escalationPoliciesRepository.findById(validatedParams.policyId, teamId);
			if (!existingPolicy) {
				throw new AppError({
					message: "Escalation policy not found",
					status: 404,
					service: SERVICE_NAME,
					method: "updateEscalationPolicy",
				});
			}

			const updatedPolicy = await this.escalationPoliciesRepository.updateById(
				validatedParams.policyId,
				teamId,
				validatedBody
			);

			return res.status(200).json({
				success: true,
				msg: "Escalation policy updated successfully",
				data: updatedPolicy,
			});
		} catch (error) {
			next(error);
		}
	};

	deleteEscalationPolicy = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedParams = deleteEscalationPolicyParamValidation.parse(req.params);

			// Verify policy exists
			const existingPolicy = await this.escalationPoliciesRepository.findById(validatedParams.policyId, teamId);
			if (!existingPolicy) {
				throw new AppError({
					message: "Escalation policy not found",
					status: 404,
					service: SERVICE_NAME,
					method: "deleteEscalationPolicy",
				});
			}

			await this.escalationPoliciesRepository.deleteById(validatedParams.policyId, teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation policy deleted successfully",
			});
		} catch (error) {
			next(error);
		}
	};
}

export default EscalationPolicyController;
