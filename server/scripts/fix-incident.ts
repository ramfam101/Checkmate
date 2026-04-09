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

// Set escalationSent to TRUE and remove the stale escalationLastSent field
const result = await mongoose.connection.db!.collection("incidents").updateOne(
	{ _id: new mongoose.Types.ObjectId("69d6ed5edbb417e1304a7cd9") },
	{ 
		$set: { escalationSent: true },
		$unset: { escalationLastSent: "" }
	}
);
console.log("Fix result:", JSON.stringify(result));

await mongoose.disconnect();
process.exit(0);
