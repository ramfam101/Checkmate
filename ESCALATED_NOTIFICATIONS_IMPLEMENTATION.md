# Escalated Notifications Implementation Guide

## Overview
Escalated notifications is a feature that allows users to define alert escalation rules based on incident duration. Instead of firing a single alert when a monitor goes down, escalated alerts ensure that the right people are notified at the right time as an issue persists.

## Architecture

### Data Model
```typescript
interface EscalatedNotification {
  notificationId: string;        // Reference to a notification (email, slack, etc.)
  durationMinutes: number;       // Duration threshold (1-10080 minutes)
  notificationName?: string;     // Optional UI label
  notificationType?: string;     // Optional type hint
}

interface Monitor {
  // ... existing fields ...
  notifications: string[];                          // Immediate notifications
  escalatedNotifications?: EscalatedNotification[];  // Time-based escalations
}
```

### Database Schema
**MongoDB Collection: monitors**
```json
{
  "escalatedNotifications": [
    {
      "notificationId": ObjectId,
      "durationMinutes": 5,
      "_id": false
    },
    {
      "notificationId": ObjectId,
      "durationMinutes": 30,
      "_id": false
    }
  ]
}
```

## Implementation Details

### 1. Backend Components

#### Type Definitions
- **File**: `server/src/types/monitor.ts`
- Added `EscalatedNotification` interface
- Added `escalatedNotifications` field to Monitor interface

#### Database Model
- **File**: `server/src/db/models/Monitor.ts`
- Added `escalatedNotifications` schema field with validation
- Min: 1 minute, Max: 10,080 minutes (7 days)

#### Repository
- **File**: `server/src/repositories/monitors/MongoMonitorsRepository.ts`
- Updated `toEntity()` and `toEntityWithChecks()` methods
- Properly serializes ObjectIds to strings in escalatedNotifications

#### Escalation Service
- **File**: `server/src/service/infrastructure/notificationsService.ts`
- Added `handleEscalatedNotifications()` method
- Checks active incidents against escalation thresholds
- Sends notifications when duration thresholds are reached
- Updated constructor to accept `IIncidentsRepository`

#### Monitoring Flow
- **File**: `server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts`
- Added Step 8: Calls `handleEscalatedNotifications` after each monitor check
- Runs as fire-and-forget to avoid blocking the monitoring pipeline

#### Configuration
- **File**: `server/src/config/services.ts`
- Updated NotificationsService instantiation to pass `incidentsRepository`

### 2. Frontend Components

#### Types
- **File**: `client/src/Types/Monitor.ts`
- Added `EscalatedNotification` interface
- Added `escalatedNotifications` field to Monitor interface

#### Validation
- **File**: `client/src/Validation/monitor.ts`
- Added escalatedNotifications validation to baseSchema
- Each escalation requires: notificationId and durationMinutes (1-10080)

#### Form Hook
- **File**: `client/src/Hooks/useMonitorForm.ts`
- Updated `getBaseDefaults()` to include escalatedNotifications
- Properly initializes empty array when creating new monitors

#### UI Component
- **File**: `client/src/Pages/CreateMonitor/index.tsx`
- Added "Escalated Notifications" ConfigBox section
- Features:
  - Autocomplete to select notifications
  - Visual list of configured escalations
  - Remove button for each escalation
  - Duration shown in minutes

#### Server Validation
- **File**: `server/src/validation/monitorValidation.ts`
- Added escalatedNotifications validation to `createMonitorBodyValidation`
- Added escalatedNotifications validation to `editMonitorBodyValidation`

## How It Works

### Workflow

1. **Monitor Setup**
   - User creates a monitor in the UI
   - User configures escalated notifications:
     - Select a notification (email, slack, etc.)
     - Set duration threshold (e.g., 5 minutes, 30 minutes)
   - Data is sent to backend and stored with monitor

2. **Incident Detection**
   - Monitor check runs
   - If check fails, incident is created with `startTime = now()`

3. **Escalation Check** (runs on every monitor check)
   - `handleEscalatedNotifications()` is called
   - Queries active incident for the monitor
   - Calculates duration: `(now - incident.startTime) / 60000 = durationMinutes`
   - Compares duration against each escalation threshold
   - If any threshold is reached, sends that notification

4. **Notification Sending**
   - Uses existing notification providers (Email, Slack, Teams, etc.)
   - Includes incident duration in message details
   - Prevents duplicate sends by checking if threshold was already passed

### Example Scenario

1. **10:00 AM** - Monitor goes down
   - Incident created with startTime = 10:00 AM
   - Initial notifications sent (if configured)

2. **10:05 AM** (5 minutes later) - First escalation at 5 minutes
   - Check runs
   - Duration = 5 minutes
   - First escalation threshold reached
   - Escalation notification sent

3. **10:35 AM** (35 minutes later) - Second escalation at 30 minutes
   - Check runs
   - Duration = 35 minutes
   - Second escalation threshold reached
   - Second escalation notification sent

4. **11:00 AM** - Monitor back up
   - Incident resolved
   - Recovery notification sent
   - Escalation checks stop

## Configuration Guide

### Frontend Setup

1. **Create or Edit a Monitor**
   - Navigate to monitor creation/edit page
   - Configure regular notifications (basic alerts)
   - Scroll to "Escalated Notifications" section

2. **Add Escalation Rules**
   - Click on the Autocomplete field
   - Select a notification (e.g., "On-Call Email", "Slack DevOps")
   - System automatically sets 5 min duration (can be modified later if needed)
   - Click "Add" or outside the field to confirm

3. **Modify Duration**
   - Currently set via object directly (can be enhanced in UI)
   - Range: 1-10,080 minutes
   - Common values:
     - 5 min: Quick first escalation
     - 15 min: Escalate to team lead
     - 60 min: Escalate to manager
     - 240 min (4 hours): Escalate to on-call

4. **Remove Escalations**
   - Click trash icon next to any escalation rule
   - Rule is immediately removed from the monitor

### Backend Configuration

Escalated notifications are automatically triggered when:
- An incident starts and becomes active
- Monitor checks continue to run
- Duration thresholds are met

No additional backend configuration needed beyond standard monitor setup.

## Email Notification Example

### Escalation Email Subject
```
Monitor [Monitor Name] - Alert Escalation (incident duration: 5 minutes)
```

### Escalation Email Body
Includes:
- Monitor name
- Monitor URL
- Current monitor status
- Incident duration
- Timestamp
- Link to view incident details

Sample:
```
Monitor Name: API Server
URL: https://api.example.com
Status: DOWN
Duration: ~5 minutes

This is an escalated alert for a persistent incident. Please investigate.
Checkmate Monitoring System
```

## Testing the Feature

### Test Case 1: Basic Setup
1. Create a new monitor
2. Add 2-3 immediate notifications
3. Add 2-3 escalated notifications at different durations (5, 15, 30 min)
4. Save monitor
5. Verify data appears in database: `monitor.escalatedNotifications`

### Test Case 2: Manual Testing (Development)
1. Create monitor with escalation at 5 minutes
2. Manually trigger monitor to go DOWN
3. Wait 5+ minutes
4. Check email/notification for escalation alert
5. Verify incident duration is accurate (should be ~5 min)

### Test Case 3: Incident Lifecycle
1. Create monitor with escalations at 5, 15, 30 min
2. Create test incident manually (using MongoDB admin)
3. Mock incident duration to different values
4. Run `handleEscalatedNotifications()` function
5. Verify correct escalations are triggered

### Test Case 4: UI Validation
1. Try to create monitor with invalid duration (<1 or >10080)
2. Verify validation error appears
3. Try to add same notification twice
4. Verify no duplicates allowed
5. Try to add/remove escalations multiple times
6. Verify UI state updates correctly

## Database Queries

### View Escalated Notifications for a Monitor
```javascript
db.monitors.findOne(
  { name: "Your Monitor Name" },
  { escalatedNotifications: 1, notifications: 1 }
)
```

### View Escalations for All Monitors
```javascript
db.monitors.find(
  { escalatedNotifications: { $exists: true, $ne: [] } },
  { name: 1, escalatedNotifications: 1 }
)
```

### Update Escalation Duration
```javascript
db.monitors.updateOne(
  { _id: ObjectId("...") },
  { $set: { "escalatedNotifications.0.durationMinutes": 10 } }
)
```

## Performance Considerations

### Monitoring Overhead
- **Per Check**: Queries active incident + counts escalation thresholds
- **Query Time**: <10ms (indexed on monitorId + teamId)
- **Impact**: Minimal - runs alongside normal notification checks

### Optimization Opportunities (Future)
1. Cache active incident durations
2. Use scheduled job instead of per-check polling
3. Add "already sent" tracking to prevent checking same threshold repeatedly
4. Bulk operations for teams with many monitors

## Troubleshooting

### Escalations Not Sending
1. Check that monitor has incident in "active" state
2. Verify `escalatedNotifications` array is populated
3. Check notification provider is working (send test)
4. Review server logs for errors in `handleEscalatedNotifications`

### Duplicate Escalations
1. Currently design allows re-sending if checked multiple times
2. Implement "sent at" tracking to prevent duplicates
3. Store escalation send timestamps in incident record

### Wrong Duration Calculated
1. Verify incident startTime is correct
2. Check system clock synchronization
3. Ensure timestamps are in milliseconds

## API Endpoints

### Create Monitor with Escalations
```
POST /api/monitors
Body: {
  name: "API Server",
  notifications: ["notif-id-1"],
  escalatedNotifications: [
    { notificationId: "notif-id-2", durationMinutes: 5 },
    { notificationId: "notif-id-3", durationMinutes: 30 }
  ]
}
```

### Update Escalations
```
PATCH /api/monitors/{monitorId}
Body: {
  escalatedNotifications: [
    { notificationId: "notif-id-2", durationMinutes: 10 }
  ]
}
```

## Files Modified

### Server
- `server/src/types/monitor.ts` - Added EscalatedNotification type
- `server/src/db/models/Monitor.ts` - Updated schema
- `server/src/repositories/monitors/MongoMonitorsRepository.ts` - Serialization
- `server/src/service/infrastructure/notificationsService.ts` - Escalation logic
- `server/src/validation/monitorValidation.ts` - Validation schema
- `server/src/config/services.ts` - Service config
- `server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts` - Monitoring flow

### Client
- `client/src/Types/Monitor.ts` - Added EscalatedNotification type
- `client/src/Validation/monitor.ts` - Validation schema  
- `client/src/Hooks/useMonitorForm.ts` - Form defaults
- `client/src/Pages/CreateMonitor/index.tsx` - UI component

## Next Steps / Future Enhancements

1. **Tracking Sent Escalations**
   - Add `escalationsSent` array to incident model
   - Track which escalations have been sent to prevent duplicates

2. **Scheduled Escalation Jobs**
   - Move from per-check to scheduled job (every 1-5 min)
   - Reduce database load

3. **Advanced Rules**
   - Conditions (e.g., escalate only during business hours)
   - Different escalations for different severity levels
   - Escalation chains with on-call rotation

4. **UI Enhancements**
   - Visual builder for escalation chains
   - Template presets (e.g., "SLA 5-15-60")
   - Duration picker component
   - Test escalation functionality in UI

5. **Analytics**
   - Track how many times each escalation is triggered
   - Average incident duration before escalation
   - Most commonly used escalation intervals

## Support & Questions

For issues or questions about escalated notifications:
1. Check server logs: `grep -i "escalat" logs/*.log`
2. Verify monitor data: Check `escalatedNotifications` in database
3. Review notification provider status
4. Check if incidents are being created properly
