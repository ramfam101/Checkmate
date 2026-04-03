import { CronJob } from "cron";
import { EscalationService } from "./service/business/escalationService.js";

export const setupEscalationJob = (escalationService: EscalationService) => {
    
    const job = new CronJob("*/1 * * * *", async () => {
        await escalationService.checkAndSendEscalations();
    });

    job.start();
    console.log("Escalation job started - runs every 1 minutes");
};