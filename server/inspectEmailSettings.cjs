const mongoose = require("mongoose");

(async () => {
	const uri = "mongodb://localhost:27017/uptime_db";
	await mongoose.connect(uri, { dbName: "uptime_db" });
	const schema = new mongoose.Schema({ systemEmailPassword: String, systemEmailUser: String, systemEmailAddress: String }, { strict: false });
	const AppSettings = mongoose.model("AppSettings", schema, "appsettings");
	const settings = await AppSettings.findOne({}).lean();
	if (!settings) {
		console.log("NO_SETTINGS");
		process.exit(0);
	}
	const pwd = settings.systemEmailPassword || "";
	console.log("HAS_PASSWORD:", pwd.length > 0);
	console.log("PASSWORD_LENGTH:", pwd.length);
	console.log("HAS_SPACES:", /\s/.test(pwd));
	console.log("USER:", settings.systemEmailUser);
	console.log("ADDRESS:", settings.systemEmailAddress);
	await mongoose.disconnect();
})();
