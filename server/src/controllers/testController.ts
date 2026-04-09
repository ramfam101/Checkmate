import type { Request, Response } from "express";
import type { IMonitorService } from "@/service/business/monitorService.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import { AppError } from "@/utils/AppError.js";

export interface TestControllerDependencies {
	monitorService: IMonitorService;
	notificationsService: INotificationsService;
}

export class TestController {
	private monitorService: IMonitorService;
	private notificationsService: INotificationsService;

	constructor(deps: TestControllerDependencies) {
		this.monitorService = deps.monitorService;
		this.notificationsService = deps.notificationsService;
	}

	/**
	 * Get current user info for testing
	 * GET /api/v1/test/user-info
	 */
	getUserInfo = async (req: Request, res: Response): Promise<void> => {
		try {
			const userId = req.user?.id;
			const teamId = req.user?.teamId;

			if (!userId || !teamId) {
				throw new AppError({ message: "User or team not found", status: 400 });
			}

			res.status(200).json({
				message: "Current user info",
				userId,
				teamId,
				instructions: "Use these IDs to create test monitor",
			});
		} catch (error: unknown) {
			if (error instanceof AppError) {
				res.status(error.status).json({ message: error.message });
				return;
			}
			res.status(500).json({
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	/**
	 * Create a test escalation monitor for debugging
	 * POST /api/v1/test/escalation-monitor
	 * Body (optional, for testing): { userId, teamId }
	 */
	createEscalationTestMonitor = async (req: Request, res: Response): Promise<void> => {
		try {
			// Allow userId/teamId to be passed in body for testing, fallback to JWT
			let userId = req.body?.userId || req.user?.id;
			let teamId = req.body?.teamId || req.user?.teamId;

			if (!userId || !teamId) {
				throw new AppError({ message: "User or team not found. Provide userId and teamId in request body.", status: 400 });
			}

			// Get all existing notifications for this team
			const existingNotifications = await this.notificationsService.findNotificationsByTeamId(teamId);

			if (existingNotifications.length === 0) {
				throw new AppError({
					message: "No notifications exist for this team. Please create at least one notification channel before testing escalations.",
					status: 400,
				});
			}

			// Extract notification IDs
			const notificationIds = existingNotifications.map((n) => n.id);

			// Create the test monitor
			const monitorData = {
				userId,
				teamId,
				name: "Local Test Server",
				description: "Test escalation monitor for http://127.0.0.1:6767/",
				type: "http" as const,
				url: "http://127.0.0.1:6767/",
				interval: 15000, // 15 seconds
				maxRetries: 0,
				retryInterval: 0,
				notifications: [], // No regular notifications
				escalationNotifications: notificationIds, // All notifications for escalation
				escalationDelayMinutes: 0, // Escalate immediately
				checkIfSSLErrorIgnored: true, // Ignore TLS/SSL errors
				numberOfCheckInSlidingWindow: 5,
				percentageOfCheckThatShouldFail: 100,
				active: true,
			};

			// Create monitor using the service
			await this.monitorService.createMonitor(teamId, userId, monitorData);

			res.status(201).json({
				message: "Test escalation monitor created successfully",
				monitor: {
					name: monitorData.name,
					url: monitorData.url,
					interval: monitorData.interval,
					escalationDelayMinutes: monitorData.escalationDelayMinutes,
					escalationNotifications: notificationIds,
					notificationCount: existingNotifications.length,
					notificationChannels: existingNotifications.map((n) => ({
						id: n.id,
						type: n.type,
						name: n.notificationName,
					})),
				},
				note: "This monitor will check http://127.0.0.1:6767/ every 15 seconds and send escalations immediately if down.",
			});
		} catch (error: unknown) {
			if (error instanceof AppError) {
				res.status(error.status).json({ message: error.message });
				return;
			}
			res.status(500).json({
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};
}
