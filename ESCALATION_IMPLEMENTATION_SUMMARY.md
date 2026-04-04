# Escalated Notifications - Implementation Summary

## What Was Built

A complete escalation notification system for Checkmate that allows users to define time-based alert escalation policies. When a monitor goes down, different notification groups can be triggered at specified time intervals (e.g., 5 min, 30 min, 2 hours).

## Files Created/Modified

### New Files

1. **`/server/src/db/models/EscalationPolicy.ts`**
   - Mongoose schema for escalation policies
   - Stores policy name, description, rules, and enabled status
   - Auto-sorts rules by delay time

2. **`/server/src/types/notification.ts`** (extended)
   - `EscalationRule` interface
   - `EscalationPolicy` interface
   - Added to notification types

3. **`/server/src/repositories/escalationPolicies/MongoEscalationPoliciesRepository.ts`**
   - Full CRUD operations for escalation policies
   - `IEscalationPoliciesRepository` interface

4. **`/server/src/repositories/escalationPolicies/index.ts`**
   - Repository exports

5. **`/server/src/service/infrastructure/escalationService.ts`**
   - `EscalationService` class
   - `checkAndTriggerEscalations()` - main escalation check loop
   - `applyEscalationToIncident()` - apply rules to specific incident
   - Handles notification sending for escalation events

6. **`/server/src/validation/escalationPolicyValidation.ts`**
   - Zod schemas for creating/updating/deleting policies
   - Validates delay times, notification references, etc.

7. **`/server/src/controllers/escalationPolicyController.ts`**
   - `EscalationPolicyController` implements CRUD endpoints
   - Authorization checks (admin only for write operations)

8. **`/server/src/routes/escalationPolicyRoute.ts`**
   - API routes: GET/POST/PATCH/DELETE escalation policies
   - Route: `/api/v1/escalation-policies`

9. **`ESCALATION_FEATURE.md`**
   - Complete feature documentation
   - Architecture details, examples, next steps

### Modified Files

1. **`/server/src/types/incident.ts`**
   - Added `escalationPolicyId` field
   - Added `escalationEventsTriggered: number[]` to track triggered rules
   - Added `lastEscalationCheckTime` for performance

2. **`/server/src/types/monitor.ts`**
   - Added optional `escalationPolicyId` field for default policy

3. **`/server/src/db/models/Incident.ts`**
   - Added MongoDB fields for escalation tracking
   - Schema includes new Incident fields above

4. **`/server/src/db/models/Monitor.ts`**
   - Added `escalationPolicyId` field to schema

5. **`/server/src/repositories/incidents/IIncidentsRepository.ts`**
   - Added `findActiveWithEscalationPolicies()` method signature

6. **`/server/src/repositories/incidents/MongoIncidentRepository.ts`**
   - Implemented `findActiveWithEscalationPolicies()`
   - Updated `toEntity()` to map escalation fields
   - Maps `escalationEventsTriggered` array and timestamps

7. **`/server/src/repositories/monitors/MongoMonitorsRepository.ts`**
   - Updated both `toEntity()` methods to map `escalationPolicyId`

8. **`.github/copilot-instructions.md`** (from earlier task)
   - Added comprehensive AI agent instructions

## Database Schema

### EscalationPolicy Collection
```javascript
{
  _id: ObjectId,
  teamId: ObjectId,      // Reference to Team
  name: String,          // 1-100 chars
  description: String,   // Optional, max 500 chars
  rules: [               // At least 1 rule
    {
      delayMinutes: Number,        // 1-10080
      notificationIds: [ObjectId]  // Notification refs
    }
  ],
  enabled: Boolean,      // Default true
  createdAt: Date,
  updatedAt: Date
}
```

### Incident Collection (Extended)
```javascript
// Existing fields plus:
{
  escalationPolicyId: ObjectId,      // Optional ref
  escalationEventsTriggered: [Number], // Delays already sent
  lastEscalationCheckTime: Date      // Last check timestamp
}
```

### Monitor Collection (Extended)
```javascript
// Existing fields plus:
{
  escalationPolicyId: ObjectId  // Optional default policy
}
```

## API Endpoints

All endpoints require JWT authentication. Admin/Superadmin required for write operations.

### GET `/api/v1/escalation-policies`
List all escalation policies for team

**Response:**
```json
{
  "success": true,
  "msg": "Escalation policies retrieved successfully",
  "data": [
    {
      "id": "string",
      "teamId": "string",
      "name": "string",
      "description": "string",
      "rules": [
        { "delayMinutes": 5, "notificationIds": ["..."] }
      ],
      "enabled": true,
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

### POST `/api/v1/escalation-policies` (Admin only)
Create new escalation policy

### PATCH `/api/v1/escalation-policies/:policyId` (Admin only)
Update escalation policy

### DELETE `/api/v1/escalation-policies/:policyId` (Admin only)
Delete escalation policy

## How It Works

1. **Policy Creation**: Admin creates escalation policy with rules
   - Each rule specifies delay (minutes) and notifications to send

2. **Policy Assignment**: Applied to monitor via `escalationPolicyId`
   - When incident created, inherits policy from monitor

3. **Incident Tracking**: Incident stores
   - `escalationPolicyId` - which policy to apply
   - `escalationEventsTriggered` - array of delays already fired
   - `lastEscalationCheckTime` - timestamp of last check

4. **Periodic Execution**: `checkAndTriggerEscalations()` runs every minute
   - Finds all active incidents with escalation policies
   - Calculates incident duration
   - Checks if any rules should fire
   - Sends notifications for triggered rules
   - Updates escalation tracking fields

5. **Resolution**: When incident resolves
   - Escalation tracking preserved for history
   - No more escalations sent

## Integration Steps (TODO)

1. **Register Services**
   - Add `EscalationService` to config/services.ts
   - Add `EscalationPolicyController` to config/controllers.ts
   - Register routes in config/routes.ts

2. **Add Periodic Job**
   - Hook `escalationService.checkAndTriggerEscalations()` to run every minute
   - Use existing BullMQ or Pulse infrastructure

3. **Update IncidentService**
   - When creating incident, retrieve policy from monitor
   - Set `incident.escalationPolicyId` if applicable

4. **Frontend Work**
   - Create escalation policy management page
   - Add policy selector to monitor edit form
   - Show escalation status in incident details

5. **Testing**
   - Unit tests for escalation service
   - Integration tests for full workflow
   - E2E tests

## Key Design Decisions

1. **Separation of Concerns**
   - Policies defined separately from monitors
   - Can reuse same policy across multiple monitors

2. **Immutable Trigger Tracking**
   - `escalationEventsTriggered` array prevents duplicate sends
   - `lastEscalationCheckTime` enables efficient queries

3. **Extensible Notification System**
   - Reuses existing notification provider system
   - No changes to email/Slack/Discord providers needed

4. **Time-Based, Not Event-Based**
   - Escalation rules trigger on elapsed time
   - Not event-based (simpler, more predictable)

5. **Admin-Only Management**
   - Only admins/superadmins can create/edit policies
   - Teams can have multiple policies
   - Users can view but not modify policies

## Performance Considerations

- `escalationEventsTriggered` prevents querying status of each rule
- Incident query filters for `status: true AND escalationPolicyId exists`
- Indexes on `teamId + enabled` for efficient policy lookup
- Caching recommendation: Call periodic check every 1 minute maximum

## Error Handling

- Uses `AppError` class with service/method context
- Validation via Zod schemas
- 404 errors for policy not found
- Proper HTTP status codes

## Testing Recommendations

1. **Unit Tests**
   - Escalation rule evaluation logic
   - Time-based triggering
   - Notification collection

2. **Integration Tests**
   - Full incident → escalation → notification flow
   - Multiple rules firing correctly
   - No duplicate sends

3. **E2E Tests**
   - Create policy → assign to monitor → trigger incident → verify escalations

## Documentation

See `ESCALATION_FEATURE.md` for complete documentation including:
- Detailed architecture
- Data model specifications
- Service layer details
- Repository methods
- API examples
- Frontend integration guide
- Next steps checklist
