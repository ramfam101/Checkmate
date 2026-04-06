import { describe, expect, it, jest } from "@jest/globals";
import NotificationController from "../src/controllers/notificationController.ts";

const createController = () => {
	const notificationsService: any = {
		testAllNotifications: jest.fn<any>().mockResolvedValue(true),
	};
	const monitorsRepository: any = {
		findById: jest.fn<any>().mockResolvedValue({
			id: "monitor-1",
			notifications: ["notification-1", "notification-2"],
			escalationNotifications: ["notification-2", "escalation-1"],
		}),
	};

	return {
		controller: new NotificationController(notificationsService, monitorsRepository),
		notificationsService,
		monitorsRepository,
	};
};

describe("NotificationController", () => {
	describe("testAllNotifications", () => {
		it("should send both normal and escalation notification IDs without duplicates", async () => {
			const { controller, notificationsService, monitorsRepository } = createController();
			const req = {
				body: { monitorId: "monitor-1" },
				user: { teamId: "team-1" },
			} as any;
			const res = {
				status: jest.fn().mockReturnThis(),
				json: jest.fn().mockReturnThis(),
			};
			const next = jest.fn();

			await controller.testAllNotifications(req, res as any, next);

			expect(monitorsRepository.findById).toHaveBeenCalledWith("monitor-1", "team-1");
			expect(notificationsService.testAllNotifications).toHaveBeenCalledWith([
				"notification-1",
				"notification-2",
				"escalation-1",
			]);
			expect(res.status).toHaveBeenCalledWith(200);
			expect(res.json).toHaveBeenCalledWith({
				success: true,
				msg: "All notifications sent successfully",
			});
			expect(next).not.toHaveBeenCalled();
		});
	});
});
