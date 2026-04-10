import { MonitorModel } from "@/db/models/index.js";

const GOOGLE_DEMO_MONITOR_NAME = "Google";
const GOOGLE_DEMO_MONITOR_URL = "https://www.google.com/generate_204";
const LEGACY_GOOGLE_DEMO_URLS = [
	"https://www.google.com",
	"https://www.google.com/",
	"https://google.com",
	"https://google.com/",
	GOOGLE_DEMO_MONITOR_URL,
] as const;

export async function fixGoogleDemoMonitor(): Promise<void> {
	await MonitorModel.updateMany(
		{
			name: GOOGLE_DEMO_MONITOR_NAME,
			description: GOOGLE_DEMO_MONITOR_NAME,
			type: "http",
			url: { $in: [...LEGACY_GOOGLE_DEMO_URLS] },
		},
		{
			$set: {
				url: GOOGLE_DEMO_MONITOR_URL,
				status: "initializing",
				statusWindow: [],
				recentChecks: [],
				uptimePercentage: undefined,
			},
		}
	);
}