import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const dbUri = process.env.DB_CONNECTION_STRING;
if (!dbUri) {
	console.error("DB_CONNECTION_STRING not set");
	process.exit(1);
}

await mongoose.connect(dbUri);
console.log("Connected to MongoDB");

// Check the monitor's notifications
const monitor = await mongoose.connection.db!.collection("monitors").findOne(
	{ _id: new mongoose.Types.ObjectId("69d6eca8dbb417e1304a7c57") }
);
console.log("\nMonitor notifications (regular):", JSON.stringify(monitor?.notifications));
console.log("Monitor escalationNotifications:", JSON.stringify(monitor?.escalationNotifications));

// Look up all notifications for comparison
const allNotifications = await mongoose.connection.db!.collection("notifications").find({}).toArray();
for (const n of allNotifications) {
	console.log(`\nNotification ${n._id}: type=${n.type}, name=${n.notificationName}, address=${n.address}`);
}

await mongoose.disconnect();
process.exit(0);
