import { Router } from "express";
import { IEscalationController } from "@/controllers/escalationController.js";

class EscalationRoutes {
	private router: Router;
	private escalationController: IEscalationController;

	constructor(escalationController: IEscalationController) {
		this.router = Router();
		this.escalationController = escalationController;
		this.initRoutes();
	}

	initRoutes() {
		// Escalation policy routes
		this.router.post("/policies", this.escalationController.createEscalationPolicy);
		this.router.get("/policies", this.escalationController.getEscalationPoliciesByTeam);
		this.router.get("/policies/monitor/:monitorId", this.escalationController.getEscalationPolicyByMonitorId);
		this.router.get("/policies/:id", this.escalationController.getEscalationPolicyById);
		this.router.put("/policies/:id", this.escalationController.updateEscalationPolicy);
		this.router.delete("/policies/:id", this.escalationController.deleteEscalationPolicy);

		// Escalation history routes
		this.router.get("/history/:incidentId", this.escalationController.getEscalationHistoryByIncident);
	}

	getRouter() {
		return this.router;
	}
}

export default EscalationRoutes;
