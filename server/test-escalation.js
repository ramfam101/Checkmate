import { Monitor } from "../../db/models/Monitor.js";
import { SuperSimpleQueueHelper } from "../infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import { MonitorStatusResponse } from "../business/monitorService.js";

// Test script to manually trigger escalation notifications
async function testEscalationNotifications() {
    console.log("Testing escalation notifications...");

    // Create a mock monitor with escalation notifications
    const mockMonitor: Monitor = {
        id: "test-monitor-123",
        name: "Test Monitor",
        url: "http://example.com",
        status: "down",
        type: "http",
        teamId: "test-team",
        escalationNotifications: [
            {
                delay: 5, // 5 minutes
                contacts: [
                    {
                        type: "email",
                        address: "test@example.com"
                    }
                ]
            },
            {
                delay: 10, // 10 minutes
                contacts: [
                    {
                        type: "email",
                        address: "admin@example.com"
                    }
                ]
            }
        ]
    } as Monitor;

    // Create mock status response
    const mockStatus: MonitorStatusResponse = {
        status: "down",
        code: 500,
        responseTime: 1000,
        timestamp: new Date()
    };

    // Get the SuperSimpleQueueHelper instance
    // This would normally be injected, but for testing we'll create it
    const queueHelper = new SuperSimpleQueueHelper(
        // We'd need to inject the actual dependencies here
        // For now, this is just to show the structure
    );

    console.log("Calling scheduleEscalationNotifications...");
    // This should trigger the escalation scheduling with our debug logs
    (queueHelper as any).scheduleEscalationNotifications(mockMonitor, mockStatus);

    console.log("Escalation notifications scheduled. Check server logs for debug output.");
}

testEscalationNotifications().catch(console.error);