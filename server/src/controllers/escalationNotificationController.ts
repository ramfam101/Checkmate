import { Request, Response, NextFunction } from "express";

import {
	createEscalationNotificationBodyValidation,
	deleteEscalationNotificationParamValidation,
	getEscalationNotificationByIdParamValidation,
	editEscalationNotificationParamValidation,
	getEscalationNotificationsByMonitorIdParamValidation,
} from "@/validation/escalationNotificationValidation.js";
import { AppError } from "@/utils/AppError.js";
import { IEscalationNotificationsRepository } from "@/repositories/index.js";
import { requireTeamId } from "./controllerUtils.js";

const SERVICE_NAME = "EscalationNotificationController";

export interface IEscalationNotificationController {
	createEscalationNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationNotificationsByMonitorId: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	deleteEscalationNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getEscalationNotificationById: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	editEscalationNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
}

class EscalationNotificationController implements IEscalationNotificationController {
	private escalationNotificationsRepository: IEscalationNotificationsRepository;

	constructor(escalationNotificationsRepository: IEscalationNotificationsRepository) {
		this.escalationNotificationsRepository = escalationNotificationsRepository;
	}

	createEscalationNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const escalationData = createEscalationNotificationBodyValidation.parse(req.body);
			const teamId = requireTeamId(req.user?.teamId);

			// Add teamId to the escalation data
			const escalationWithTeam = { ...escalationData, teamId };

			const escalation = await this.escalationNotificationsRepository.create(escalationWithTeam);

			return res.status(201).json({
				success: true,
				msg: "Escalation notification created successfully",
				data: escalation,
				details: { service: SERVICE_NAME },
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationNotificationsByMonitorId = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { monitorId } = getEscalationNotificationsByMonitorIdParamValidation.parse(req.params);
			const teamId = requireTeamId(req.user?.teamId);

			// Note: We should add team filtering to the repository method, but for now we'll fetch all and filter
			const escalations = await this.escalationNotificationsRepository.findByMonitorId(monitorId);

			// Filter by teamId (assuming we add teamId to escalation notifications)
			const teamEscalations = escalations.filter(e => (e as any).teamId === teamId);

			return res.status(200).json({
				success: true,
				msg: "Escalation notifications retrieved successfully",
				data: teamEscalations,
				details: { service: SERVICE_NAME },
			});
		} catch (error) {
			next(error);
		}
	};

	deleteEscalationNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = deleteEscalationNotificationParamValidation.parse(req.params);
			const teamId = requireTeamId(req.user?.teamId);

			// First check if the escalation belongs to the team
			const escalation = await this.escalationNotificationsRepository.findById(id);
			if ((escalation as any).teamId !== teamId) {
				throw new AppError({ message: "Escalation notification not found", status: 404 });
			}

			const deletedEscalation = await this.escalationNotificationsRepository.deleteById(id);

			return res.status(200).json({
				success: true,
				msg: "Escalation notification deleted successfully",
				data: deletedEscalation,
				details: { service: SERVICE_NAME },
			});
		} catch (error) {
			next(error);
		}
	};

	getEscalationNotificationById = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = getEscalationNotificationByIdParamValidation.parse(req.params);
			const teamId = requireTeamId(req.user?.teamId);

			const escalation = await this.escalationNotificationsRepository.findById(id);

			// Check if escalation belongs to the team
			if ((escalation as any).teamId !== teamId) {
				throw new AppError({ message: "Escalation notification not found", status: 404 });
			}

			return res.status(200).json({
				success: true,
				msg: "Escalation notification retrieved successfully",
				data: escalation,
				details: { service: SERVICE_NAME },
			});
		} catch (error) {
			next(error);
		}
	};

	editEscalationNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = editEscalationNotificationParamValidation.parse(req.params);
			const updateData = editEscalationNotificationParamValidation.parse(req.body);
			const teamId = requireTeamId(req.user?.teamId);

			// First check if the escalation belongs to the team
			const existingEscalation = await this.escalationNotificationsRepository.findById(id);
			if ((existingEscalation as any).teamId !== teamId) {
				throw new AppError({ message: "Escalation notification not found", status: 404 });
			}

			const updatedEscalation = await this.escalationNotificationsRepository.updateById(id, updateData);

			return res.status(200).json({
				success: true,
				msg: "Escalation notification updated successfully",
				data: updatedEscalation,
				details: { service: SERVICE_NAME },
			});
		} catch (error) {
			next(error);
		}
	};
}

export default EscalationNotificationController;