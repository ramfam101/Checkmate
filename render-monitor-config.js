// Checkmate Monitor Configuration for Render App
// This configuration monitors https://postman-demo-s219.onrender.com

const renderMonitorConfig = {
  "type": "http",
  "url": "https://postman-demo-s219.onrender.com",
  "name": "render site",
  "interval": 15000, // 15 seconds
  "statusWindowSize": 5, // 5 checks in sliding window
  "statusWindowThreshold": 60, // 60% failure threshold (3 out of 5 checks must fail)
  "ignoreTlsErrors": false, // Enable proper TLS/SSL validation
  "geoCheckEnabled": true, // Enable geo-distributed checks
  "geoCheckLocations": ["North America", "Europe", "Asia"], // Check from these continents
  "geoCheckInterval": 300000, // Geo checks every 5 minutes (300,000 ms)
  "notifications": [], // Add notification IDs here if needed
  "escalationDelayMinutes": null, // Optional escalation delay
  "escalationNotifications": [] // Optional escalation notifications
};

// Example: Create monitor via API
async function createRenderMonitor() {
  try {
    const response = await fetch('/api/v1/monitors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add authorization header as needed
      },
      body: JSON.stringify(renderMonitorConfig)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Monitor created successfully:', result);
      return result;
    } else {
      console.error('Failed to create monitor:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error creating monitor:', error);
  }
}

// Uncomment to create the monitor
// createRenderMonitor();

module.exports = renderMonitorConfig;