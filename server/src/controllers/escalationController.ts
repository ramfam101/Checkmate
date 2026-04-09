import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/AppError.js";
import { requireTeamId } from "./controllerUtils.js";
import { IEscalationService } from "@/service/business/escalationService.js";
import {
	createEscalationPolicyBodyValidation,
	updateEscalationPolicyBodyValidation,
	escalationPolicyIdParamValidation,
	monitorIdParamValidation,
	incidentIdParamValidation,
} from "@/validation/escalationValidation.js";

const SERVICE_NAME = "EscalationController";

export interface IEscalationController {
	createEscalationPolicy: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationPoliciesByTeam: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationPolicyById: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationPolicyByMonitorId: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	updateEscalationPolicy: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	deleteEscalationPolicy: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationHistoryByIncident: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
}

class EscalationController implements IEscalationController {
	private escalationService: IEscalationService;

	constructor(escalationService: IEscalationService) {
		this.escalationService = escalationService;
	}

	createEscalationPolicy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedBody = createEscalationPolicyBodyValidation.parse(req.body);

			const policy = await this.escalationService.createEscalationPolicy({
				...validatedBody,
				teamId,
			});

			return res.status(201).json({
				success: true,
				msg: "Escalation policy created successfully",
				data: policy,
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationPoliciesByTeam = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const policies = await this.escalationService.getEscalationPoliciesByTeam(teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation policies retrieved successfully",
				data: policies,
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationPolicyById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const { id } = escalationPolicyIdParamValidation.parse(req.params);

			const policy = await this.escalationService.getEscalationPolicyById(id, teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation policy retrieved successfully",
				data: policy,
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationPolicyByMonitorId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const { monitorId } = monitorIdParamValidation.parse(req.params);

			const policy = await this.escalationService.getEscalationPolicyByMonitorId(monitorId, teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation policy retrieved successfully",
				data: policy,
			});
		} catch (error) {
			next(error);
		}
	};

	updateEscalationPolicy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const { id } = escalationPolicyIdParamValidation.parse(req.params);
			const validatedBody = updateEscalationPolicyBodyValidation.parse(req.body);

			const updated = await this.escalationService.updateEscalationPolicy(id, teamId, validatedBody);

			return res.status(200).json({
				success: true,
				msg: "Escalation policy updated successfully",
				data: updated,
			});
		} catch (error) {
			next(error);
		}
	};

	deleteEscalationPolicy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const { id } = escalationPolicyIdParamValidation.parse(req.params);

			const deleted = await this.escalationService.deleteEscalationPolicy(id, teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation policy deleted successfully",
				data: deleted,
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationHistoryByIncident = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
		try {
			requireTeamId(req.user?.teamId);
			const { incidentId } = incidentIdParamValidation.parse(req.params);

			const history = await this.escalationService.getEscalationHistoryByIncident(incidentId);

			if (!history) {
				throw new AppError({ message: "Escalation history not found for this incident", status: 404, service: SERVICE_NAME });
			}

			return res.status(200).json({
				success: true,
				msg: "Escalation history retrieved successfully",
				data: history,
			});
		} catch (error) {
			next(error);
		}
	};
}

export default EscalationController;
