# Notification Escalation UI Implementation Guide

This guide describes how to implement the UI components for managing notification escalations per monitor.

## Overview

The escalation system allows users to configure "escalation channels" for monitors. If an incident remains unacknowledged after a specified delay, a notification is sent to the escalation channel (another notification configured on the team).

## Components to Create

### 1. **EscalationRulesDialog** 
**Location:** `client/src/Components/monitors/EscalationRulesDialog.tsx`

A modal dialog that displays and manages escalation rules for a monitor.

```typescript
interface EscalationRule {
  notificationId: string;
  delayMinutes: number;
  escalationChannelId: string;
}

interface EscalationRulesDialogProps {
  open: boolean;
  onClose: () => void;
  monitorId: string;
  currentEscalations: EscalationRule[];
  availableNotifications: Notification[];
  onSave: (escalations: EscalationRule[]) => Promise<void>;
}
```

**Features:**
- Display existing escalation rules in a list/table
- Add new escalation rules  
- Edit existing rules
- Delete rules
- Dropdown selectors for source notification and escalation channel

### 2. **EscalationRuleRow**
**Location:** `client/src/Components/monitors/EscalationRuleRow.tsx`

A row component representing a single escalation rule.

```typescript
interface EscalationRuleRowProps {
  rule: EscalationRule;
  notifications: Notification[];
  onUpdate: (rule: EscalationRule) => void;
  onDelete: () => void;
}
```

**Features:**
- Display/edit notification (readonly)
- Input field for delay in minutes (with validation: min 1)
- Dropdown to select escalation channel
- Delete button

### 3. **AddEscalationRuleForm**
**Location:** `client/src/Components/monitors/AddEscalationRuleForm.tsx`

A form for adding new escalation rules to a monitor.

```typescript
interface AddEscalationRuleFormProps {
  usedNotifications: string[];
  availableNotifications: Notification[];
  onAdd: (rule: EscalationRule) => void;
  onCancel: () => void;
}
```

**Features:**
- Dropdown to select source notification (exclude already escalated ones)
- Number input for delay in minutes (1-1440 range suggested)
- Dropdown to select escalation channel (must be different from source)
- Add and Cancel buttons

## Integration Points

### 1. Monitor Edit Form
Add an "Escalations" section or button to the monitor edit form that opens `EscalationRulesDialog`.

### 2. Hook for Escalation Management
Create a custom hook: `client/src/Hooks/useEscalations.ts`

```typescript
const useEscalations = (monitorId: string) => {
  const [escalations, setEscalations] = useState<EscalationRule[]>([]);
  
  const updateEscalations = async (newEscalations: EscalationRule[]) => {
    const response = await patchMonitorEscalations(monitorId, newEscalations);
    setEscalations(response.escalations);
    return response;
  };
  
  return { escalations, updateEscalations };
};
```

### 3. API Integration
Create/update `client/src/Utils/NetworkService.ts` with new endpoints:

```typescript
// Update monitor escalations
patchMonitorEscalations = (monitorId: string, escalations: EscalationRule[]) => 
  this.patch(`/monitors/escalations`, { monitorId, escalations });

// Acknowledge incident (prevent further escalations)
acknowledgeIncident = (incidentId: string) =>
  this.put(`/incidents/${incidentId}/acknowledge`);
```

## UI Flows

### Flow 1: Configure Escalations for a Monitor
1. User navigates to monitor page
2. Clicks "Edit" or "Configure Escalations" button
3. `EscalationRulesDialog` opens showing:
   - List of current escalation rules (if any)
   - "Add Rule" button
4. User can:
   - Edit delay minutes for existing rules
   - Change escalation channel
   - Delete rules
   - Add new rules (opens `AddEscalationRuleForm`)
5. User saves, API call updates monitor with escalations array

### Flow 2: Incident Escalation Occurs
1. System detects unacknowledged incident age exceeds delay
2. Escalation notification is sent to configured channel
3. Incident is marked with escalation metadata
4. No further escalations sent to same channel

### Flow 3: User Acknowledges Incident
1. User views incident details
2. Clicks "Acknowledge" button
3. Incident marked as `acknowledged: true`
4. Escalation clock resets (no more escalations)

## Validation Rules

- **Delay Minutes:** Must be 1-1440 (1 minute to 24 hours)
- **Escalation Channel:** Cannot be the same as source notification
- **Max Escalations per Notification:** Recommend 5 (can add to schema)
- **Duplicate Rules:** Prevent duplicate source notification + channel combinations

## Translation Keys Needed

```json
{
  "pages.monitor.escalations": {
    "title": "Notification Escalations",
    "description": "Configure escalation rules to send alerts to additional channels if incidents remain unacknowledged",
    "addRule": "Add Escalation Rule",
    "noRules": "No escalation rules configured",
    "columns": {
      "notification": "Source Notification",
      "delay": "Delay (minutes)",
      "escalationChannel": "Escalation Channel",
      "actions": "Actions"
    },
    "validation": {
      "delayRequired": "Delay is required",
      "delayMin": "Minimum delay is 1 minute",
      "delayMax": "Maximum delay is 1440 minutes (24 hours)",
      "channelRequired": "Escalation channel is required",
      "channelMustDiffer": "Escalation channel must be different from source notification",
      "noDuplicates": "This escalation rule already exists"
    }
  },
  "pages.incidents": {
    "acknowledge": "Acknowledge",
    "acknowledged": "Acknowledged",
    "acknowledgeDescription": "Mark this incident as acknowledged to prevent further escalations"
  }
}
```

## API Endpoints Reference

- `PATCH /monitors/escalations` - Update monitor escalations
- `PUT /incidents/:incidentId/acknowledge` - Acknowledge an incident

## State Management

Consider adding to Redux store:
- `monitorEscalations: Record<string, EscalationRule[]>` - Cache escalations
- `escalationsLoading: boolean` - Loading state
- `selectedMonitorForEscalation: string | null` - Current monitor being edited

## Example Component Structure

```
client/src/Components/monitors/
├── EscalationRulesDialog.tsx
├── EscalationRuleRow.tsx
├── AddEscalationRuleForm.tsx
└── EscalationRulesManager.tsx (container component)
```

## Testing Recommendations

1. **Unit Tests:**
   - Validation of delay minutes
   - Duplicate rule detection
   - Channel difference validation

2. **Integration Tests:**
   - Add escalation rule via API
   - Update escalations for monitor
   - Delete escalation rule
   - Acknowledge incident

3. **E2E Tests:**
   - Configure escalations in UI
   - Monitor incident triggering escalation
   - User acknowledging incident
