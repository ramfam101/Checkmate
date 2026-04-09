import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { UserModel } from "./src/db/models/index.js";
import { NotificationModel } from "./src/db/models/index.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "my_secret_key_change_this";
const DB_CONNECTION = process.env.DB_CONNECTION_STRING || "mongodb://localhost:27017/uptime_db";
const API_URL = "http://localhost:52345/api/v1/test/escalation-monitor";

async function runTest() {
	try {
		// Connect to MongoDB
		console.log("🔌 Connecting to MongoDB...");
		await mongoose.connect(DB_CONNECTION);
		console.log("✅ Connected to MongoDB");

		// Find the first user and team
		console.log("🔍 Finding user and team...");
		const user = await UserModel.findOne();
		if (!user) {
			console.error("❌ No users found in database. Please create a user first.");
			await mongoose.disconnect();
			process.exit(1);
		}

		const teamId = user.teamId?.toString() || user.teams?.[0]?.toString();
		const userId = user._id.toString();

		if (!teamId) {
			console.error("❌ User has no team. Please join or create a team first.");
			await mongoose.disconnect();
			process.exit(1);
		}

		console.log("👤 Found user:", userId);
		console.log("👥 Team ID:", teamId);

		// Check if team has notifications
		const notifications = await NotificationModel.find({ teamId: new mongoose.Types.ObjectId(teamId) });
		console.log(`📬 Found ${notifications.length} notification(s) in team`);

		if (notifications.length === 0) {
			console.error("❌ No notifications found for this team. Create a notification channel first.");
			await mongoose.disconnect();
			process.exit(1);
		}

		// Create JWT token
		const payload = { id: userId, teamId, role: "admin" };
		const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

		console.log("\n🔐 Generated JWT token");
		console.log("📡 Calling endpoint: POST", API_URL);
		console.log("\n⏳ Waiting for response...\n");

		// Call test endpoint
		const response = await fetch(API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
		});

		const data = await response.json();

		if (response.ok) {
			console.log("✅ SUCCESS! Test monitor created:");
			console.log(JSON.stringify(data, null, 2));
			console.log("\n📋 Next steps:");
			console.log("1. Keep http://127.0.0.1:6767/ DOWN");
			console.log("2. Monitor will check every 15 seconds");
			console.log("3. After 5 failed checks (~75 sec), escalation emails should be sent");
			console.log("4. Check server logs for: [ESCALATION SCHEDULER] and [ESCALATION CALLBACK]");
		} else {
			console.log("❌ ERROR:", response.status);
			console.log(JSON.stringify(data, null, 2));
		}

		await mongoose.disconnect();
	} catch (error) {
		console.error("❌ Error:", error instanceof Error ? error.message : error);
		await mongoose.disconnect();
		process.exit(1);
	}
}

runTest();
