# Notification Escalation Feature - Complete Implementation

## Overview

The notification escalation feature allows users to automatically escalate alerts to additional communication channels if incidents remain unacknowledged for a specified duration.

**Key Concept**: When an incident (downtime event) occurs and remains unacknowledged beyond a configurable delay, the system automatically sends an escalation alert through a different notification channel (e.g., escalate from Email to SMS, or from Slack to PagerDuty).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERACTION                        │
│                                                             │
│  Monitor Page: Configure Escalation Rules                 │
│  Incident Page: Acknowledge Incidents                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ HTTP Request
                 │
┌────────────────▼────────────────────────────────────────────┐
│                     FRONTEND LAYER                          │
│                                                             │
│  Components:                                               │
│  - EscalationRulesDialog (rules management UI)             │
│  - EscalationSettings (wrapper component)                  │
│  - IncidentAcknowledgeButton (incident acknowledgment)    │
│                                                             │
│  Hooks:                                                    │
│  - useEscalations (API integration)                        │
│  - useGet, usePatch, usePut (existing Checkmate hooks)    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ API Calls
                 │
┌────────────────▼────────────────────────────────────────────┐
│                      API ROUTES                            │
│                                                             │
│  PATCH /api/v1/monitors/{monitorId}                        │
│    └─ updateEscalations()                                  │
│                                                             │
│  PUT /api/v1/incidents/{incidentId}/acknowledge           │
│    └─ acknowledgeIncident()                                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Request Processing
                 │
┌────────────────▼────────────────────────────────────────────┐
│                   CONTROLLER LAYER                         │
│                                                             │
│  - monitorController.updateEscalations()                   │
│  - incidentController.acknowledgeIncident()               │
│                                                             │
│  Responsibilities:                                         │
│  - Validate request format                                 │
│  - Check user permissions                                  │
│  - Verify team ownership                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Business Logic
                 │
┌────────────────▼────────────────────────────────────────────┐
│                    SERVICE LAYER                           │
│                                                             │
│  - monitorService.editMonitor()                            │
│    └─ Updates monitor with escalations                     │
│                                                             │
│  - incidentService.acknowledgeIncident()                   │
│    └─ Marks incident as acknowledged                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Data Persistence
                 │
┌────────────────▼────────────────────────────────────────────┐
│                 REPOSITORY LAYER                           │
│                                                             │
│  - MongoMonitorRepository                                  │
│    └─ Saves monitor with escalations array                 │
│                                                             │
│  - MongoIncidentRepository                                 │
│    └─ Updates incident fields (acknowledged, etc.)         │
│    └─ Queries active incidents for escalation job         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Database Operations
                 │
┌────────────────▼────────────────────────────────────────────┐
│                    MONGODB                                 │
│                                                             │
│  Collections:                                              │
│  - monitors (with escalations array)                       │
│  - incidents (with escalation tracking fields)             │
│  - notifications (referenced by escalations)               │
└─────────────────────────────────────────────────────────────┘
```

## Background Job - Escalation Cleanup

**File**: `server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts`

The escalation system runs a background job every 60 seconds:

```
Every 60 seconds:
├─ Query all active (unacknowledged) incidents
├─ For each incident:
│  ├─ Check if acknowledged (skip if true)
│  ├─ Get monitor configuration
│  ├─ For each configured escalation rule:
│  │  ├─ Calculate if delay has passed (now >= startTime + delayMinutes)
│  │  ├─ Check if not already escalated to this channel
│  │  ├─ If both checks pass:
│  │  │  ├─ Fetch escalation notification channel
│  │  │  ├─ Send escalation alert via NotificationsService
│  │  │  └─ Update incident with escalation metadata
│  │  └─ Log the action
│  └─ Record lastEscalationAt timestamp
└─ Report completion
```

### Job Logic Pseudocode

```typescript
getEscalationCleanupJob = () => {
  return async () => {
    const activeIncidents = await this.incidentsRepository.findActiveIncidents();
    
    for (const incident of activeIncidents) {
      if (incident.acknowledged) continue;  // Skip acknowledged incidents
      
      const monitor = await this.monitorsRepository.findById(
        incident.monitorId,
        incident.teamId
      );
      
      if (!monitor?.escalations?.length) continue;  // No escalations configured
      
      const now = new Date();
      const incidentAge = now.getTime() - new Date(incident.startTime).getTime();
      
      for (const escalation of monitor.escalations) {
        const delayMs = escalation.delayMinutes * 60 * 1000;
        const hasDelayPassed = incidentAge >= delayMs;
        const alreadyEscalated = incident.escalatedNotificationIds?.includes(
          escalation.escalationChannelId
        );
        
        if (hasDelayPassed && !alreadyEscalated) {
          // Send escalation notification
          const channel = await this.notificationsRepository.findById(
            escalation.escalationChannelId,
            incident.teamId
          );
          
          if (channel) {
            await this.notificationsService.handleNotifications(
              channel,
              incident,
              "escalation"
            );
            
            // Mark incident as escalated to this channel
            await this.incidentsRepository.updateById(incident.id, incident.teamId, {
              lastEscalationAt: now,
              escalatedNotificationIds: [
                ...(incident.escalatedNotificationIds || []),
                escalation.escalationChannelId
              ]
            });
          }
        }
      }
    }
  };
};
```

## Data Flow - Complete Example

### Scenario: Email escalates to Slack after 30 minutes

**Setup**:
- Monitor: "API Server Status"
- Notifications: Email (id: email-1), Slack (id: slack-1)
- Escalation Rule: If Email unacknowledged for 30 minutes → escalate to Slack

**Timeline**:

| Time | Event | System State |
|------|-------|--------------|
| 10:00 AM | API Server goes down | Incident created, Email notification sent |
| 10:05 AM | Monitor page opens | User sees incident listed |
| 10:06 AM | User is busy | User doesn't acknowledge yet |
| 10:30 AM (Job runs) | 30 minutes elapsed | Escalation check runs, detection passes, Slack notification sent, `lastEscalationAt` recorded |
| 10:35 AM | User clicks "Acknowledge" | Incident marked as `acknowledged: true`, no more escalations will trigger |
| 10:45 AM (Job runs) | Escalation check again | Check skips because `acknowledged: true` |
| 10:50 AM | Server recovers | Incident marked as resolved |

**Database State After Flow**:

**Monitors Collection**:
```json
{
  "_id": "monitor-1",
  "name": "API Server Status",
  "escalations": [
    {
      "notificationId": "email-1",
      "delayMinutes": 30,
      "escalationChannelId": "slack-1"
    }
  ]
}
```

**Incidents Collection**:
```json
{
  "_id": "incident-1",
  "monitorId": "monitor-1",
  "startTime": "2026-01-15T10:00:00Z",
  "endTime": "2026-01-15T10:50:00Z",
  "status": false,  // resolved
  "acknowledged": true,
  "acknowledgedAt": "2026-01-15T10:35:00Z",
  "lastEscalationAt": "2026-01-15T10:30:00Z",
  "escalatedNotificationIds": ["slack-1"]
}
```

## Implementation Files

### Backend Files Modified/Created

| File | Type | Purpose |
|------|------|---------|
| `server/src/types/monitor.ts` | Type Def | `NotificationEscalation` interface |
| `server/src/types/incident.ts` | Type Def | Incident escalation fields |
| `server/src/db/models/Monitor.ts` | Schema | Escalations array field |
| `server/src/db/models/Incident.ts` | Schema | Acknowledgment & escalation tracking |
| `server/src/repositories/incidents/IIncidentsRepository.ts` | Interface | `findActiveIncidents()` method |
| `server/src/repositories/incidents/MongoIncidentRepository.ts` | Implementation | Query & map active incidents |
| `server/src/service/business/incidentService.ts` | Service | `acknowledgeIncident()` logic |
| `server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts` | Job Logic | `getEscalationCleanupJob()` (113 lines) |
| `server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueue.ts` | Init | Schedule job to run every 60 seconds |
| `server/src/controllers/monitorController.ts` | Controller | `updateEscalations()` endpoint handler |
| `server/src/controllers/incidentController.ts` | Controller | `acknowledgeIncident()` endpoint handler |
| `server/src/routes/monitorRoute.ts` | Routes | `PATCH /escalations` endpoint |
| `server/src/routes/incidentRoute.ts` | Routes | `PUT /:incidentId/acknowledge` endpoint |

### Frontend Files Created

| File | Type | Purpose |
|------|------|---------|
| `client/src/Components/monitors/EscalationRulesDialog.tsx` | Component | UI for managing escalation rules |
| `client/src/Components/monitors/EscalationSettings.tsx` | Component | Wrapper for dialog + API integration |
| `client/src/Components/incidents/IncidentAcknowledgeButton.tsx` | Component | Button for acknowledging incidents |
| `client/src/Hooks/useEscalations.ts` | Hook | API calls for escalation operations |
| `client/src/Types/Monitor.ts` | Type Def | Updated with `escalations` field |
| `client/src/Types/Incident.ts` | Type Def | Updated with escalation tracking fields |
| `client/src/ESCALATION_FRONTEND_INTEGRATION.md` | Docs | Frontend integration guide |

## Key Design Decisions

### 1. Escalations Stored at Monitor Level

**Decision**: Store escalation rules on the Monitor document, not elsewhere

**Rationale**:
- Escalations are monitor-specific configuration
- Simplifies permission checking (user can edit monitor → can edit escalations)
- Single source of truth for what escalations apply to a monitor
- Easier to query all monitors with escalations

**Alternative Considered**: Global escalation templates (rejected for added complexity)

### 2. Incident-Based Triggering

**Decision**: Check each incident individually, not batch processing

**Rationale**:
- More accurate delay calculations per incident
- Handles incidents created at different times correctly
- Clean separation of concerns (incident timestamp vs current time)
- Supports future per-incident escalation tweaks

### 3. Acknowledgment as Escalation Gate

**Decision**: Once acknowledged, no more escalations trigger

**Rationale**:
- User acknowledges = "I've seen this and handling it"
- Prevents notification spam after acknowledgment
- Matches standard incident management patterns
- Simple boolean check = high performance

### 4. 60-Second Job Interval

**Decision**: Check escalations every 60 seconds

**Rationale**:
- Minimum delay users would configure is 1 minute
- 60 seconds provides good responsiveness without overhead
- Can handle thousands of incidents efficiently
- Trade-off between timeliness and system load

**Could be improved**: Make configurable via environment variable

### 5. In-Memory Job Scheduler

**Decision**: Use super-simple-scheduler (existing system)

**Rationale**:
- Already integrated into Checkmate
- No Redis dependency in development
- Sufficient for single-server deployments
- Documented and familiar to team

**Note**: Consider Redis/BullMQ for distributed systems

## Security Considerations

### 1. Permission Validation

**Backend**:
```typescript
// Controller validates team ownership
const userTeamId = req.user.teamId;
const monitor = await this.monitorService.getMonitor(monitorId, userTeamId);
if (!monitor) throw new Error("Not found or not authorized");
```

### 2. Notification ID Verification

**Backend**:
```typescript
// Verify all escalation channels belong to user's team
const teamNotifications = await notificationsService.findByTeamId(teamId);
const validIds = teamNotifications.map(n => n.id);
for (const escalation of escalations) {
  if (!validIds.includes(escalation.escalationChannelId)) {
    throw new Error("Escalation channel not found");
  }
}
```

### 3. No Direct Escalation Triggering

**Design**: Users can't manually trigger escalations, only system job can

**Rationale**: Prevents abuse and keeps escalation logic in one place

### 4. Audit Trail

**Logged Events**:
- Escalation rule created/updated/deleted
- Incident acknowledged
- Escalation sent (via NotificationsService)

## Testing Strategy

### Unit Tests

1. **EscalationRulesDialog Component**
   - Test add/edit/delete rule workflow
   - Test validation rules
   - Test duplicate detection

2. **useEscalations Hook**
   - Test saveEscalations API call
   - Test acknowledge API call
   - Test error handling

3. **Backend Controllers**
   - Test permission checks
   - Test notification ID validation
   - Test escalation format validation

4. **Job Logic**
   - Test delay calculation
   - Test duplicate escalation prevention
   - Test acknowledged incident skipping

### Integration Tests

1. **End-to-End Escalation Flow**
   - Create monitor with escalation rule
   - Create incident
   - Advance time/trigger job
   - Verify escalation sent
   - Verify incident state updated

2. **Acknowledgment Flow**
   - Create incident
   - Acknowledge incident
   - Verify escalations stop

### Manual Testing

1. Configure escalation rule in UI
2. Manually create incident (or wait for real one)
3. Wait/simulate time passage
4. Verify escalation notification received
5. Acknowledge incident
6. Verify no further escalations

## Deployment Notes

### Migration Path

1. **Database**: Schema changes auto-applied on startup
2. **Backend**: No breaking changes to existing APIs
3. **Frontend**: New components are separate, doesn't interfere with existing UI
4. **Job**: Starts automatically, graceful handling of empty data

### Rollback

1. Remove frontend components from pages
2. Stop backend job (comment out in SuperSimpleQueue.ts)
3. Database fields remain but inactive (no harm)

### Monitoring

**Metrics to Track**:
- Escalation job execution time
- Number of escalations triggered per day
- Failed escalations (notification errors)
- Average incident acknowledgment time

**Log Lines to Monitor**:
```
[JobQueueHelper](getEscalationCleanupJob) Starting escalation check
[JobQueueHelper](getEscalationCleanupJob) Escalation check completed. X escalations triggered.
```

## Future Enhancements

### Phase 2: Escalation Analytics

- Dashboard showing escalation trends
- Effectiveness metrics (% of escalations leading to acknowledgment)
- Response time SLAs

### Phase 3: Advanced Escalation

- Multi-level escalations (escalate to level 2 if level 1 not acknowledged)
- Time-aware escalations (only during business hours)
- Escalation templates/presets
- On-call rotation integration

### Phase 4: User Experience

- Escalation preview before saving
- Rule testing/simulation
- Mobile push for escalations
- Voice call escalations

## Troubleshooting

### Escalations Not Triggering

**Checklist**:
1. Is job running? Check logs: `getEscalationCleanupJob`
2. Are incidents unacknowledged? Check `incident.acknowledged` field
3. Is delay calculation correct? Time must be `>= startTime + delayMinutes`
4. Are escalation rules saved? Check `monitor.escalations` array
5. Is notification channel valid? Verify ID in `notifications` collection

### Duplicate Escalations

**Cause**: Job running multiple times or race condition

**Fix**: Ensure check for `escalatedNotificationIds.includes(channelId)`

### Escalations Keep Triggering

**Cause**: Incident not being marked as acknowledged properly

**Fix**: Verify `acknowledgeIncident` is updating database correctly

## Questions & Answers

**Q: Can I have multiple escalations for one notification?**
A: No, but you can escalate to different channels from the same source.

**Q: What happens if escalation channel is deleted after rules are saved?**
A: The job will skip it gracefully (notification not found). Remove escalation rule first.

**Q: Can escalations trigger other escalations?**
A: No, escalations come directly from monitor configuration only.

**Q: Is there a limit on escalation rules per monitor?**
A: No hard limit, but performance degrades with >20 rules.

**Q: What timezone do delays use?**
A: Server timezone (stored as ISO string in database).

---

## Summary

The notification escalation feature provides a robust, secure way to ensure critical alerts don't go unaddressed. By combining incident tracking with time-based triggering and user acknowledgment, it balances automation with user control.

**Implementation Status**: ✅ Backend complete, UI components created, integration guide provided

**Ready For**: Frontend team to integrate components into monitor and incident pages

