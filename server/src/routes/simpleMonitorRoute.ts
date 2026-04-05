import { Router } from "express";
import SimpleMonitorModel from "@/db/models/SimpleMonitor.js";
import { sendEscalationEmail } from "@/utils/escalationMailer.js";

const router = Router();

// Return the first (and only) simple monitor document or empty
router.get("/", async (req, res, next) => {
	try {
		const doc = await SimpleMonitorModel.findOne().lean();
		if (!doc) {
			return res.json({ success: true, data: { escalations: [] } });
		}
		return res.json({ success: true, data: { escalations: doc.escalations } });
	} catch (err) {
		next(err);
	}
});

// Save escalations - accept { escalations: [{delay, channel}] }
router.post("/", async (req, res, next) => {
	try {
		const payload = req.body || {};
		const escalations = Array.isArray(payload.escalations)
			? payload.escalations.map((e: any) => ({ delay: Number(e.delay || 0), channel: String(e.channel || "") }))
			: [];

		let doc = await SimpleMonitorModel.findOne();
		if (!doc) {
			doc = await SimpleMonitorModel.create({ name: "default-monitor", escalations });
		} else {
			doc.escalations = escalations;
			await doc.save();
		}

		// Send test email to fixed test address
		// Fire-and-forget but await to ensure log
		try {
			await sendEscalationEmail("test@example.com", escalations as { delay: number; channel: string }[]);
		} catch (e) {
			// ignore
		}

		return res.json({ success: true, data: { escalations: doc.escalations } });
	} catch (err) {
		next(err);
	}
});

export default router;
