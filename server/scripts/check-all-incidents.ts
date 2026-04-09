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

// Find ALL active incidents for this monitor
const incidents = await mongoose.connection.db!.collection("incidents").find(
	{ monitorId: new mongoose.Types.ObjectId("69d6eca8dbb417e1304a7c57"), status: true }
).toArray();

console.log(`Found ${incidents.length} active incidents:`);
for (const inc of incidents) {
	console.log(JSON.stringify(inc, null, 2));
}

await mongoose.disconnect();
process.exit(0);
