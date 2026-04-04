# Escalated Notifications Feature Implementation

This document provides an overview of the **Escalated Notifications** feature that has been implemented in Checkmate.

## Feature Overview

Escalated Notifications allow users to define alert timing rules for incidents based on how long a monitor has been down. Rather than sending a single alert when a monitor fails, escalation policies enable different notification groups to be triggered at specified time intervals, ensuring the right people are notified at the right time as an issue persists.

### Use Cases

1. **Initial Alert**: Notify ops team immediately when a monitor goes down
2. **Escalation After 5 Minutes**: Notify managers if issue persists
3. **Escalation After 1 Hour**: Notify executives if still unresolved
4. **Escalation After 4 Hours**: Trigger incident management protocol

## Architecture

### Data Models

#### EscalationPolicy
- **Location**: `/server/src/db/models/EscalationPolicy.ts`
- **Type**: `EscalationPolicy` in `/server/src/types/notification.ts`
- **Fields**:
  - `id`: Unique identifier
  - `teamId`: Team this policy belongs to
  - `name`: Human-readable policy name
  - `description`: Optional description
  - `rules`: Array of escalation rules (ordered by delay)
  - `enabled`: Boolean to enable/disable the policy
  - `createdAt`, `updatedAt`: Timestamps

#### EscalationRule
- **Part of**: EscalationPolicy
- **Fields**:
  - `delayMinutes`: When to trigger (in minutes after incident start)
  - `notificationIds`: Array of notification channels to alert

#### Incident (Extended)
- **Location**: `/server/src/db/models/Incident.ts`
- **New Fields**:
  - `escalationPolicyId`: Reference to the escalation policy applied to this incident
  - `escalationEventsTriggered`: Array of delays that have already been triggered
  - `lastEscalationCheckTime`: When escalation was last checked

#### Monitor (Extended)
- **Location**: `/server/src/db/models/Monitor.ts`
- **New Field**:
  - `escalationPolicyId`: Default escalation policy for incidents on this monitor (optional)

### Services

#### EscalationService
- **Location**: `/server/src/service/infrastructure/escalationService.ts`
- **Responsibilities**:
  - Check active incidents periodically
  - Evaluate which escalation rules should be triggered
  - Send escalation notifications
  - Track which rules have been triggered

**Key Methods**:
- `checkAndTriggerEscalations()`: Called periodically (suggest every 1 minute)
- `applyEscalationToIncident()`: Apply escalation logic to a single incident
- `sendEscalationNotifications()`: Send notifications for a triggered rule

### Repositories

#### IEscalationPoliciesRepository / MongoEscalationPoliciesRepository
- **Location**: `/server/src/repositories/escalationPolicies/`
- **Methods**:
  - `findById(policyId, teamId)`: Get specific policy
  - `findByTeamId(teamId)`: Get all policies for team
  - `findEnabledByTeamId(teamId)`: Get only enabled policies
  - `create(policy, teamId)`: Create new policy
  - `updateById(policyId, teamId, updateData)`: Update policy
  - `deleteById(policyId, teamId)`: Delete policy

### Controllers & Routes

#### EscalationPolicyController
- **Location**: `/server/src/controllers/escalationPolicyController.ts`
- **Endpoints**:
  - `GET /api/v1/escalation-policies` - List team's escalation policies
  - `GET /api/v1/escalation-policies/:policyId` - Get specific policy
  - `POST /api/v1/escalation-policies` - Create policy (admin only)
  - `PATCH /api/v1/escalation-policies/:policyId` - Update policy (admin only)
  - `DELETE /api/v1/escalation-policies/:policyId` - Delete policy (admin only)

#### Routes
- **Location**: `/server/src/routes/escalationPolicyRoute.ts`

### Validation

#### Schemas
- **Location**: `/server/src/validation/escalationPolicyValidation.ts`
- **Schemas**:
  - `createEscalationPolicyValidation`: Validate new policy creation
  - `updateEscalationPolicyValidation`: Validate policy updates
  - Additional helper validations for parameters and queries

**Validation Rules**:
- Policy name: 1-100 characters
- Description: 0-500 characters
- Each rule requires:
  - `delayMinutes`: 1-10080 (1 minute to 7 days)
  - `notificationIds`: At least one notification channel
- No duplicate delay times allowed across rules

## Integration

### How to Apply Escalation Policy to a Monitor

1. **Via Monitor Creation/Update**:
   ```typescript
   // When creating or updating a monitor, include:
   escalationPolicyId: "policy-id-string"
   ```

2. **When Incident is Created**:
   - The incident service should retrieve the escalation policy from the monitor
   - Set `incident.escalationPolicyId` when creating the incident

### Periodic Execution

The `EscalationService.checkAndTriggerEscalations()` method should be called periodically:

**Recommended Setup** (using existing BullMQ/Pulse infrastructure):
```typescript
// Add to job queue or Pulse cron:
- Job: "checkEscalations"
- Frequency: Every 1 minute
- Handler: escalationService.checkAndTriggerEscalations()
```

### Notification Escalation Flow

```
1. Monitor goes DOWN
   ↓
2. Incident created with escalationPolicyId
   ↓
3. Initial notifications sent
   ↓
4. Escalation checker runs every minute:
   - Check incident duration
   - Compare against escalation rules
   - If rule triggered and not already sent:
     * Mark rule as triggered
     * Send notifications
     * Update incident.lastEscalationCheckTime
   ↓
5. When incident resolves:
   - escalationEventsTriggered array preserved for history
   - Can be referenced in incident details
```

## Implementation Checklist

### Completed
- ✅ Database models (EscalationPolicy, Incident extensions)
- ✅ Type definitions
- ✅ Repository with full CRUD operations
- ✅ Service layer for escalation logic
- ✅ Validation schemas
- ✅ Controller with business logic
- ✅ API routes
- ✅ Copilot instructions updated

### To Be Completed
- ⚠️ Wire up periodic escalation checks (add to job queue)
- ⚠️ Update IncidentService to apply escalation policies on creation
- ⚠️ Frontend UI for escalation policy management
- ⚠️ Extend Monitor form to support escalation policy selection
- ⚠️ Add escalation information to incident details views
- ⚠️ Tests for escalation service
- ⚠️ Tests for escalation policy controller/repository
- ⚠️ Documentation updates

## Frontend Considerations

### Pages to Create/Modify
1. **Escalation Policies Management Page**
   - List all policies
   - Create new policy
   - Edit existing policy
   - Delete policy
   - Test policy (send sample escalation)

2. **Monitor Editor**
   - Add dropdown to select escalation policy
   - Show policy details/preview
   - Clear policy option

3. **Incident Details**
   - Show if escalation policy is applied
   - Show escalation events history
   - Show next scheduled escalation time

### Type Definitions for Frontend
The frontend should expect and use the types defined in:
- `EscalationPolicy` and `EscalationRule` from `/server/src/types/notification.ts`

## API Examples

### Create Escalation Policy
```bash
POST /api/v1/escalation-policies
Authorization: Bearer <token>

{
  "name": "Standard IT Escalation",
  "description": "Escalate to managers after 30 mins, execs after 2 hours",
  "rules": [
    {
      "delayMinutes": 5,
      "notificationIds": ["notification-id-1"]
    },
    {
      "delayMinutes": 30,
      "notificationIds": ["notification-id-2", "notification-id-3"]
    },
    {
      "delayMinutes": 120,
      "notificationIds": ["notification-id-4"]
    }
  ],
  "enabled": true
}
```

### Get Escalation Policies
```bash
GET /api/v1/escalation-policies
Authorization: Bearer <token>
```

### Update Escalation Policy
```bash
PATCH /api/v1/escalation-policies/:policyId
Authorization: Bearer <token>

{
  "name": "Updated Policy Name",
  "enabled": false
}
```

### Delete Escalation Policy
```bash
DELETE /api/v1/escalation-policies/:policyId
Authorization: Bearer <token>
```

## Database Indexes

Escalation Policy collection has indexes for:
- `teamId` + `enabled` - for finding enabled policies
- `teamId` + `createdAt` - for listing policies chronologically

Incident collection has updated indexes:
- `escalationPolicyId` queries (implicitly indexed via ref)

## Error Handling

The feature follows Checkmate's error handling patterns:
- Uses `AppError` class with service/method/details context
- Repository methods throw `AppError` on not found (404)
- Controller methods use try-catch with `next(error)` pattern
- Validation uses Zod with clear error messages

## Next Steps

1. **Register Services & Controllers** in config files:
   - Add `EscalationService` to `/server/src/config/services.ts`
   - Add `EscalationPolicyController` to `/server/src/config/controllers.ts`
   - Register routes in `/server/src/config/routes.ts`

2. **Add Periodic Job**:
   - Hook up `escalationService.checkAndTriggerEscalations()` to run every minute
   - Can use existing BullMQ or Pulse setup

3. **Update IncidentService**:
   - When creating incident, retrieve escalation policy from monitor
   - Set escalation policy on incident

4. **Frontend Development**:
   - Create escalation policy management UI
   - Add escalation policy selector to monitor form
   - Display escalation status in incident details

5. **Testing**:
   - Unit tests for EscalationService
   - Integration tests for escalation trigger logic
   - E2E tests for full workflow

## References

- AI Instructions: `/github/copilot-instructions.md`
- Original Issue: [Link to issue in repository]
- Related PR: [Link to feature branch]
