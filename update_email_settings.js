const { MongoClient } = require('mongodb');

async function updateEmailSettings() {
  const client = new MongoClient('mongodb://localhost:27017');
  
  try {
    await client.connect();
    const db = client.db('uptime_db');
    
    await db.collection('appsettings').updateOne({}, {
      $set: {
        systemEmailHost: 'smtp.gmail.com',
        systemEmailPort: 465,
        systemEmailSecure: true,
        systemEmailPassword: 'lnblwqtvqvzadxqo'
      }
    });
    
    console.log('Email settings updated successfully');
  } finally {
    await client.close();
  }
}

updateEmailSettings().catch(console.error);