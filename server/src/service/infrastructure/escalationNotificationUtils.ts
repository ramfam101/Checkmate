import type { MonitorEscalationStep } from "@/types/monitor.js";

/** Returns escalation step indices that are due and not yet fired (by index). */
export function getDueEscalationStepIndices(
	steps: MonitorEscalationStep[],
	incidentStartMs: number,
	nowMs: number,
	firedIndices: number[]
): number[] {
	const fired = new Set(firedIndices);
	const due: number[] = [];
	for (let i = 0; i < steps.length; i++) {
		if (fired.has(i)) {
			continue;
		}
		const step = steps[i];
		if (!step) {
			continue;
		}
		const delayMs = step.delayMinutes * 60_000;
		if (nowMs - incidentStartMs >= delayMs) {
			due.push(i);
		}
	}
	return due;
}
