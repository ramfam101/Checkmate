import { MonitorModel } from "@/db/models/index.js";

export async function resetGoogleDnsFailureState(): Promise<void> {
	await MonitorModel.updateMany(
		{
			type: "http",
			url: /google\.com/i,
			status: "down",
			recentChecks: {
				$elemMatch: {
					message: /EDESTRUCTION/i,
				},
			},
		},
		{
			$set: {
				status: "initializing",
				statusWindow: [],
				recentChecks: [],
				uptimePercentage: undefined,
			},
		}
	);
}