import { initializeServices } from "./config/services.js";
import { initializeControllers } from "./config/controllers.js";
import { createApp } from "./app.js";
import { initShutdownListener } from "./shutdown.js";
import { validateEnv } from "./validation/envValidation.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { runMigrations } from "./db/migration/index.js";
import { EscalationService } from "./service/business/escalationService.js";
import { setupEscalationJob } from "./escalationJob.js";

import Logger, { ILogger } from "@/utils/logger.js";
import { SettingsService } from "@/service/index.js";
import { MongoSettingsRepository } from "./repositories/index.js";

const SERVICE_NAME = "Server";
let logger: ILogger;

const startApp = async () => {
    // Validate environment variables first
    const env = validateEnv();

    // FE path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, "../openapi.json"), "utf8"));
    const frontendPath = path.join(__dirname, "..", "public");

    // Create services
    const settingsRepository = new MongoSettingsRepository();
    const settingsService = new SettingsService(settingsRepository, env);

    const envSettings = settingsService.loadSettings();

    // Create logger
    logger = new Logger({ envSettings });

    // Initialize services
    const services = await initializeServices({ logger, envSettings, settingsService, settingsRepository });

    await runMigrations(logger);

    // Initialize controllers
    const controllers = initializeControllers(services);

    // Initialize escalation service
    const escalationService = new EscalationService(
        services.emailService,
        services.monitorsRepository,
        services.checksRepository,
        services.notificationsRepository,
        logger
    );

    // Setup escalation job (runs every 5 minutes)
    setupEscalationJob(escalationService);

    const app = createApp({
        services,
        controllers,
        envSettings,
        frontendPath,
        openApiSpec,
    });

    const server = app.listen(env.PORT, () => {
        logger.info({ message: `Server started on port:${env.PORT}` });
        logger.info({ message: "Escalation service initialized" });
    });

    initShutdownListener(server, services);
};

startApp().catch((error) => {
    logger.error({
        message: error.message,
        service: SERVICE_NAME,
        method: "startApp",
        stack: error.stack,
    });
    process.exit(1);
});