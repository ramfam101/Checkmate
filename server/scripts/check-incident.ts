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

const incident = await mongoose.connection.db!.collection("incidents").findOne(
	{ _id: new mongoose.Types.ObjectId("69d6ed5edbb417e1304a7cd9") }
);
console.log("Incident:", JSON.stringify(incident, null, 2));

await mongoose.disconnect();
process.exit(0);
