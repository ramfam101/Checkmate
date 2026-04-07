import { Request, Response, NextFunction } from "express";

import {
	createNotificationBodyValidation,
	deleteNotificationParamValidation,
	getNotificationByIdParamValidation,
	testNotificationBodyValidation,
	editNotificationParamValidation,
	testAllNotificationsBodyValidation,
} from "@/validation/notificationValidation.js";
import { AppError } from "@/utils/AppError.js";
import type { ILogger } from "@/utils/logger.js";
import { INotificationsService } from "@/service/index.js";
import { requireTeamId, requireUserId } from "./controllerUtils.js";
import { IMonitorsRepository } from "@/repositories/index.js";

const SERVICE_NAME = "NotificationController";

export interface INotificationController {
	testNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	createNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getNotificationsByTeamId: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	deleteNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	getNotificationById: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	editNotification: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
	testAllNotifications: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;
}
class NotificationController implements INotificationController {
	private notificationsService: INotificationsService;
	private monitorsRepository: IMonitorsRepository;
	private logger: ILogger;
	constructor(notificationsService: INotificationsService, monitorsRepository: IMonitorsRepository, logger: ILogger) {
		this.notificationsService = notificationsService;
		this.monitorsRepository = monitorsRepository;
		this.logger = logger;
	}

	testNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const notification = testNotificationBodyValidation.parse(req.body);
			const success = await this.notificationsService.sendTestNotification(notification);

			if (!success) {
				const errorMsg =
					notification.type === "email"
						? "Email notification failed - please verify email settings are configured in Settings (SMTP host, port, address, password)"
						: `${notification.type} notification failed - please verify the configuration`;
				throw new AppError({ message: errorMsg, status: 500 });
			}

			return res.status(200).json({
				success: true,
				msg: "Notification sent successfully",
				details: { service: SERVICE_NAME },
			});
		} catch (error) {
			next(error);
		}
	};

	createNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const validatedBody = createNotificationBodyValidation.parse(req.body);

			const teamId = requireTeamId(req.user?.teamId);
			const userId = requireUserId(req.user?.id);

			const notification = await this.notificationsService.createNotification(validatedBody, userId, teamId);
			return res.status(200).json({
				success: true,
				msg: "Notification created successfully",
				data: notification,
			});
		} catch (error) {
			next(error);
		}
	};

	getNotificationsByTeamId = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const notifications = await this.notificationsService.findNotificationsByTeamId(teamId);

			return res.status(200).json({
				success: true,
				msg: "Notifications fetched successfully",
				data: notifications,
			});
		} catch (error) {
			next(error);
		}
	};

	deleteNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedParams = deleteNotificationParamValidation.parse(req.params);

			await this.notificationsService.deleteById(validatedParams.id, teamId);
			return res.status(200).json({
				success: true,
				msg: "Notification deleted successfully",
			});
		} catch (error) {
			next(error);
		}
	};

	getNotificationById = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const teamId = requireTeamId(req.user?.teamId);
			const validatedParams = getNotificationByIdParamValidation.parse(req.params);

			const notification = await this.notificationsService.findById(validatedParams.id, teamId);

			return res.status(200).json({
				success: true,
				msg: "Notification fetched successfully",
				data: notification,
			});
		} catch (error) {
			next(error);
		}
	};

	editNotification = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const validatedBody = createNotificationBodyValidation.parse(req.body);
			const validatedParams = editNotificationParamValidation.parse(req.params);

			const teamId = requireTeamId(req.user?.teamId);
			const notificationId = validatedParams.id;

			const editedNotification = await this.notificationsService.updateById(notificationId, teamId, validatedBody);
			return res.status(200).json({
				success: true,
				msg: "Notification updated successfully",
				data: editedNotification,
			});
		} catch (error) {
			next(error);
		}
	};

	testAllNotifications = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const validatedBody = testAllNotificationsBodyValidation.parse(req.body);

			const teamId = requireTeamId(req.user?.teamId);

			const monitor = await this.monitorsRepository.findById(validatedBody.monitorId, teamId);
			const regularNotifications = monitor.notifications ?? [];
			const escalationNotifications = monitor.escalationNotifications ?? [];

			if (regularNotifications.length === 0 && escalationNotifications.length === 0) {
				throw new AppError({ message: "No notifications configured for this monitor", status: 400 });
			}

			// Use the new method that handles escalation notifications with simulated downtime
			const result = await this.notificationsService.testAllNotificationsWithEscalation(monitor, regularNotifications, escalationNotifications);

			if (!result) {
				throw new AppError({ message: "Failed to send one or more notifications - check your notification channel configuration", status: 500 });
			}

			return res.status(200).json({
				success: true,
				msg: "All notifications sent successfully",
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error({
				message: `testAllNotifications failed: ${errorMsg}`,
				service: SERVICE_NAME,
				method: "testAllNotifications",
				stack: errorStack,
				details: {
					requestBody: req.body,
					monitorId: (req.body as any)?.monitorId,
				},
			});
			next(error);
		}
	};
}

export default NotificationController;
