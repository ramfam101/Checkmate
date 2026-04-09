import { RequestHandler, Router } from "express";
import { TestController } from "@/controllers/testController.js";
import { IMonitorService } from "@/service/business/monitorService.js";
import { INotificationsService } from "@/service/infrastructure/notificationsService.js";

class TestRoutes {
	private router: Router;
	private testController: TestController;

	constructor(monitorService: IMonitorService, notificationsService: INotificationsService, verifyJWT: RequestHandler) {
		this.router = Router();
		this.testController = new TestController({ monitorService, notificationsService });
		this.initRoutes(verifyJWT);
	}

	initRoutes(verifyJWT: RequestHandler) {
		this.router.get("/user-info", verifyJWT, this.testController.getUserInfo);
		this.router.post("/escalation-monitor", verifyJWT, this.testController.createEscalationTestMonitor);
	}

	getRouter() {
		return this.router;
	}
}

export default TestRoutes;
