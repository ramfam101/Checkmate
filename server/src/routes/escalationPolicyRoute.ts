import { Router, type RequestHandler } from "express";
import type { IEscalationPolicyController } from "@/controllers/escalationPolicyController.js";
import { isAllowed } from "@/middleware/isAllowed.js";

class EscalationPolicyRoutes {
	private router: Router;
	private escalationPolicyController: IEscalationPolicyController;

	constructor(escalationPolicyController: IEscalationPolicyController, verifyJWT: RequestHandler) {
		this.router = Router();
		this.escalationPolicyController = escalationPolicyController;
		this.initRoutes(verifyJWT);
	}

	initRoutes(verifyJWT: RequestHandler) {
		// Get all escalation policies for team
		this.router.get("/", verifyJWT, this.escalationPolicyController.getEscalationPoliciesByTeamId);

		// Get specific escalation policy
		this.router.get("/:policyId", verifyJWT, this.escalationPolicyController.getEscalationPolicyById);

		// Create escalation policy
		this.router.post("/", verifyJWT, isAllowed(["admin", "superadmin"]), this.escalationPolicyController.createEscalationPolicy);

		// Update escalation policy
		this.router.patch("/:policyId", verifyJWT, isAllowed(["admin", "superadmin"]), this.escalationPolicyController.updateEscalationPolicy);

		// Delete escalation policy
		this.router.delete(
			"/:policyId",
			verifyJWT,
			isAllowed(["admin", "superadmin"]),
			this.escalationPolicyController.deleteEscalationPolicy
		);
	}

	getRouter() {
		return this.router;
	}
}

export default EscalationPolicyRoutes;
