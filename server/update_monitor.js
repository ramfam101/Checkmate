import mongoose from 'mongoose';
import MonitorModel from './src/db/models/Monitor.js';

async function updateMonitorStatus() {
  try {
    await mongoose.connect('mongodb://localhost:27017/uptime_db');
    console.log('Connected to MongoDB');

    const monitor = await MonitorModel.findById('69d486ead98695c7de510259');
    console.log('Monitor:', {
      id: monitor._id,
      name: monitor.name,
      status: monitor.status,
      notifications: monitor.notifications,
      url: monitor.url,
      type: monitor.type
    });

    const result = await MonitorModel.updateOne(
      { _id: '69d486ead98695c7de510259' },
      { status: 'up' }
    );

    console.log('Update result:', result);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
  }
}

updateMonitorStatus();