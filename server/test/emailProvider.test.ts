import { describe, expect, it, jest } from "@jest/globals";
import { EmailProvider } from "../src/service/infrastructure/notificationProviders/email.ts";
import type { Notification } from "../src/types/notification.ts";
import type { NotificationMessage } from "../src/types/notificationMessage.ts";

const createLogger = () => ({
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
});

const createNotification = (overrides: Partial<Notification> = {}): Notification => ({
	id: "notif-1",
	userId: "user-1",
	teamId: "team-1",
	type: "email",
	notificationName: "Base email",
	address: "ops@example.com",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const createMessage = (overrides: Partial<NotificationMessage> = {}): NotificationMessage => ({
	type: "monitor_down",
	severity: "critical",
	monitor: {
		id: "mon-1",
		name: "render server",
		url: "https://example.com",
		type: "http",
		status: "down",
	},
	content: {
		title: "Escalation: render server is still down",
		summary: 'Monitor "render server" is still down after 1 minute.',
		details: [],
		timestamp: new Date(),
	},
	clientHost: "http://localhost:5173",
	metadata: {
		teamId: "team-1",
		notificationReason: "status_change",
		isEscalation: true,
		escalationMinutes: 1,
	},
	...overrides,
});

describe("EmailProvider", () => {
	it("uses an escalation-prefixed subject for escalation emails", async () => {
		const emailService = {
			buildEmail: jest.fn().mockResolvedValue("<html>ok</html>"),
			sendEmail: jest.fn().mockResolvedValue("message-id-1"),
		};
		const provider = new EmailProvider(emailService as never, createLogger() as never);
		const notification = createNotification();
		const message = createMessage();

		const result = await provider.sendMessage(notification, message);

		expect(result).toBe(true);
		expect(emailService.sendEmail).toHaveBeenCalledWith(
			notification.address,
			"Escalation: render server is still down",
			expect.any(String)
		);
	});
});
