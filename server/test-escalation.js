import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "my_secret_key_change_this";
const API_URL = "http://localhost:52345/api/v1/test/escalation-monitor";

async function runTest() {
	// Create a test JWT token
	const payload = {
		id: "test-user-id-123",
		teamId: "test-team-id-456",
		role: "admin",
	};

	const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

	console.log("🔐 Generated JWT token:", token);
	console.log("\n📡 Calling endpoint: POST", API_URL);
	console.log("User ID:", payload.id);
	console.log("Team ID:", payload.teamId);
	console.log("\n⏳ Waiting for response...\n");

	try {
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
		} else {
			console.log("❌ ERROR:", response.status);
			console.log(JSON.stringify(data, null, 2));
		}
	} catch (error) {
		console.error("❌ Request failed:", error);
	}
}

runTest();
