import Monitor from "@/db/models/Monitor.js";

async function resetMonitorRuntimeState(): Promise<void> {
    await Monitor.updateMany(
        {},
        {
            $set: {
                status: "initializing",
                statusWindow: [],
                recentChecks: [],
            },
        }
    );
}

export { resetMonitorRuntimeState };