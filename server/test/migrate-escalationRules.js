// Migration script to add escalationRules to all monitors if missing
const mongoose = require('mongoose');
const Monitor = require('../src/db/models/Monitor');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/checkmate');
  const result = await Monitor.updateMany(
    { escalationRules: { $exists: false } },
    { $set: { escalationRules: [] } }
  );
  console.log(`Updated ${result.nModified} monitors to add escalationRules array.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
