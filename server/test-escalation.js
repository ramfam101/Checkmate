import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import { EmailService } from "../src/service/infrastructure/emailService.ts";
import { SettingsService } from "../src/service/system/settingsService.ts";
import { MongoSettingsRepository } from "../src/repositories/settings/MongoSettingsRepository.ts";
import { MongoNotificationsRepository } from "../src/repositories/notifications/MongoNotificationsRepository.ts";
import { MongoNotificationProvidersRepository } from "../src/repositories/notificationProviders/MongoNotificationProvidersRepository.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { MonitorStatusResponse } from "../src/types/monitor.ts";

// Mock logger
const logger = {
	info: console.log,
	error: console.error,
	warn: console.warn,
	debug: console.debug,
};

// Create services
const settingsRepo = new MongoSettingsRepository();
const settingsService = new SettingsService(settingsRepo, {
	JWT_SECRET: "test",
	TOKEN_TTL: "1h",
	NODE_ENV: "test",
	LOG_LEVEL: "debug",
	CLIENT_HOST: "http://localhost:5173",
	DB_CONNECTION_STRING: "mongodb://localhost:27017/uptime_db",
});

const emailService = new EmailService(settingsService, logger);
const notificationsRepo = new MongoNotificationsRepository();
const notificationProvidersRepo = new MongoNotificationProvidersRepository();

const notificationsService = new NotificationsService(
	notificationsRepo,
	notificationProvidersRepo,
	emailService,
	logger
);

// Mock monitor with escalation
const mockMonitor: Monitor = {
	id: "test-monitor",
	name: "Test Monitor",
	url: "http://example.com",
	type: "http",
	interval: 60000,
	teamId: "test-team",
	status: "down",
	escalation: {
		enabled: true,
		delayMinutes: 1,
		notifications: ["email-notification-id"],
	},
};

// Mock monitor status response
const mockStatusResponse: MonitorStatusResponse = {
	monitor: mockMonitor,
	statusChanged: true,
	prevStatus: "up",
	code: 500,
	responseTime: 1000,
	message: "Test failure",
};

// Test escalation notification
async function testEscalation() {
	try {
		console.log("Testing escalation notification...");

		const result = await notificationsService.handleEscalationNotification(mockMonitor, mockStatusResponse);

		console.log("Escalation notification result:", result);
	} catch (error) {
		console.error("Error testing escalation:", error);
	}
}

testEscalation();