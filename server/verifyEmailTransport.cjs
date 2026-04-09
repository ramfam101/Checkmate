const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

(async () => {
	const uri = "mongodb://localhost:27017/uptime_db";
	await mongoose.connect(uri, { dbName: "uptime_db" });
	const schema = new mongoose.Schema(
		{
			systemEmailHost: String,
			systemEmailPort: Number,
			systemEmailSecure: Boolean,
			systemEmailUser: String,
			systemEmailAddress: String,
			systemEmailPassword: String,
			systemEmailConnectionHost: String,
			systemEmailIgnoreTLS: Boolean,
			systemEmailRequireTLS: Boolean,
			systemEmailRejectUnauthorized: Boolean,
		},
		{ strict: false }
	);
	const AppSettings = mongoose.model("AppSettings", schema, "appsettings");
	const settings = await AppSettings.findOne({}).lean();
	if (!settings) {
		console.log("NO_SETTINGS");
		process.exit(0);
	}
	const transporter = nodemailer.createTransport({
		host: settings.systemEmailHost,
		port: Number(settings.systemEmailPort),
		secure: settings.systemEmailSecure,
		auth: {
			user: settings.systemEmailUser || settings.systemEmailAddress,
			pass: settings.systemEmailPassword,
		},
		name: settings.systemEmailConnectionHost || "localhost",
		tls: {
			rejectUnauthorized: settings.systemEmailRejectUnauthorized,
			ignoreTLS: settings.systemEmailIgnoreTLS,
			requireTLS: settings.systemEmailRequireTLS,
		},
	});

	try {
		await transporter.verify();
		console.log("VERIFY_OK");
	} catch (err) {
		console.error("VERIFY_ERROR");
		console.error(err && err.message ? err.message : err);
		if (err && err.responseCode) {
			console.error("RESPONSE_CODE:", err.responseCode);
		}
	} finally {
		await mongoose.disconnect();
	}
})();
