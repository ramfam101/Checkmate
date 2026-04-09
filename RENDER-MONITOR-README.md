# Render App Monitor Configuration

This configuration monitors the Render app at `https://postman-demo-s219.onrender.com` using Checkmate's uptime monitoring system.

## Configuration Details

### Monitor Settings
- **Type**: HTTP(S) - Standard web endpoint monitoring
- **URL**: `https://postman-demo-s219.onrender.com`
- **Display Name**: "render site"
- **Check Interval**: Every 15 seconds (15,000 ms)

### Incident Detection
- **Sliding Window**: 5 checks
- **Failure Threshold**: 60% (3 out of 5 checks must fail to trigger incident)
- **Health Logic**: Monitor reports "healthy" when site responds successfully

### Security & Validation
- **TLS/SSL Validation**: Enabled (proper certificate validation)
- **No Raw Ports**: Uses standard HTTPS port (443)
- **No ICMP/Ping**: HTTP-based monitoring only

### Geo-Distributed Checks
- **Enabled**: Yes
- **Locations**: North America, Europe, Asia
- **Geo Check Interval**: Every 5 minutes (300,000 ms)

## Files

- `render-monitor-config.json` - Pure JSON configuration
- `render-monitor-config.js` - JavaScript module with API example

## Usage

### Via Checkmate UI
1. Navigate to monitor creation page
2. Select "HTTP" monitor type
3. Fill in the configuration values as specified above
4. Save the monitor

### Via API
Use the JavaScript example in `render-monitor-config.js`:

```javascript
const config = require('./render-monitor-config.js');
createRenderMonitor(); // Creates the monitor via API
```

### Expected Behavior
- Monitor will check the Render app every 15 seconds
- Site will be considered healthy if it responds with HTTP 200+ status
- Incidents will be created if 3 out of 5 consecutive checks fail
- Geo checks will validate the site from multiple continents every 5 minutes
- All TLS certificates will be properly validated

## Notes
- The configuration includes empty notification arrays - add notification IDs as needed
- Escalation features are disabled (set to null) but can be configured if desired
- Geo check locations can be expanded to include more continents if needed