import { IEscalationNotificationController } from "@/controllers/escalationNotificationController.js";
import { Router } from "express";

class EscalationNotificationRoutes {
	private router: Router;
	private escalationNotificationController: IEscalationNotificationController;

	constructor(escalationNotificationController: IEscalationNotificationController) {
		this.router = Router();
		this.escalationNotificationController = escalationNotificationController;
		this.initializeRoutes();
	}

	initializeRoutes() {
		this.router.post("/", this.escalationNotificationController.createEscalationNotification);

		this.router.get("/monitor/:monitorId", this.escalationNotificationController.getEscalationNotificationsByMonitorId);

		this.router.get("/:id", this.escalationNotificationController.getEscalationNotificationById);
		this.router.delete("/:id", this.escalationNotificationController.deleteEscalationNotification);
		this.router.patch("/:id", this.escalationNotificationController.editEscalationNotification);
	}

	getRouter() {
		return this.router;
	}
}

export default EscalationNotificationRoutes;