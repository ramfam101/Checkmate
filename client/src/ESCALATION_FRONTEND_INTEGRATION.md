# Frontend Escalation Integration Guide

## Overview

This guide covers the integration of notification escalation UI components into the Checkmate frontend. The implementation includes components for managing escalation rules and acknowledging incidents.

## Components Created

### 1. EscalationRulesDialog

**Location**: `client/src/Components/monitors/EscalationRulesDialog.tsx`

A Material-UI dialog component that manages escalation rules for a monitor. Provides UI for:
- Viewing existing escalation rules
- Adding new escalation rules
- Editing existing rules (delay and escalation channel)
- Deleting escalation rules
- Form validation

**Props**:
```typescript
interface EscalationRulesDialogProps {
  open: boolean;
  onClose: () => void;
  monitorId: string;
  currentEscalations: EscalationRule[];
  availableNotifications: Notification[];
  onSave: (escalations: EscalationRule[]) => Promise<void>;
  loading?: boolean;
}
```

**Features**:
- Client-side validation (delay between 1-1440 minutes)
- Duplicate rule detection
- Prevents circular escalations (source ≠ channel)
- Inline table editing for quick updates
- Add/edit/delete workflow

---

### 2. EscalationSettings

**Location**: `client/src/Components/monitors/EscalationSettings.tsx`

A wrapper component that:
- Opens/closes the EscalationRulesDialog
- Handles API integration via the `useEscalations` hook
- Displays the count of configured escalation rules
- Shows loading state during save operations
- Provides success/error toast notifications

**Props**:
```typescript
interface EscalationSettingsProps {
  monitor: Monitor;
  notifications: Notification[];
  onSaveSuccess?: () => void;
}
```

**Usage Example**:
```tsx
<EscalationSettings
  monitor={currentMonitor}
  notifications={availableNotifications}
  onSaveSuccess={() => refetchMonitor()}
/>
```

---

### 3. IncidentAcknowledgeButton

**Location**: `client/src/Components/incidents/IncidentAcknowledgeButton.tsx`

A reusable button component for acknowledging incidents. Features:
- Shows confirmation dialog before acknowledgment
- Disables when incident is already acknowledged
- Loading state during API call
- Shows success/error notifications
- Customizable button appearance (variant, size, fullWidth)

**Props**:
```typescript
interface IncidentAcknowledgeButtonProps {
  incident: Incident;
  onAcknowledgeSuccess?: (acknowledgedIncident: Incident) => void;
  variant?: "contained" | "outlined" | "text";
  size?: "small" | "medium" | "large";
  fullWidth?: boolean;
}
```

**Usage Example**:
```tsx
<IncidentAcknowledgeButton
  incident={currentIncident}
  onAcknowledgeSuccess={(updatedIncident) => handleRefresh()}
  variant="contained"
/>
```

---

### 4. useEscalations Hook

**Location**: `client/src/Hooks/useEscalations.ts`

Custom React hook that handles API calls for escalation operations. Wraps the `usePatch` and `usePut` hooks from the existing Checkmate API layer.

**Returns**:
```typescript
interface UseEscalationsReturn {
  saveEscalations: (monitorId: string, escalations: EscalationRule[]) => Promise<void>;
  acknowledge: (incidentId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}
```

**Methods**:
- `saveEscalations()`: PATCH `/monitors/{monitorId}` with escalations array
- `acknowledge()`: PUT `/incidents/{incidentId}/acknowledge`

**Usage Example**:
```tsx
const { saveEscalations, acknowledge, isLoading, error } = useEscalations();

const handleSave = async () => {
  try {
    await saveEscalations(monitorId, escalationRules);
  } catch (err) {
    console.error(err);
  }
};
```

---

## Integration Points

### 1. Monitor Edit Page Integration

**File**: `client/src/Pages/CreateMonitor/index.tsx`

Add the EscalationSettings component to the monitor configuration form:

```tsx
// At the top with other imports
import { EscalationSettings } from "@/Components/monitors/EscalationSettings";

// In the monitor form JSX, add a new section:
<ConfigBox
  title={t("pages.createMonitor.form.escalations.title")}
  subtitle={t("pages.createMonitor.form.escalations.description")}
>
  <EscalationSettings
    monitor={existingMonitor}
    notifications={notificationsData}
    onSaveSuccess={() => refetchMonitor()}
  />
</ConfigBox>
```

**Location**: Add after the notifications configuration section, before the dialog/modal components.

**Data Dependencies**:
- `existingMonitor`: The current monitor being edited (required, available as state)
- `notificationsData`: Array of available notifications (fetch via useGet hook)

---

### 2. Incident Details/List Integration

**File**: `client/src/Pages/Incidents/index.tsx` or incident detail components

Add the IncidentAcknowledgeButton to incident rows/details:

```tsx
// At the top with other imports
import { IncidentAcknowledgeButton } from "@/Components/incidents/IncidentAcknowledgeButton";

// In the incident table body (for list):
<TableCell>
  <IncidentAcknowledgeButton
    incident={incident}
    onAcknowledgeSuccess={(updated) => refetchIncidents()}
    size="small"
  />
</TableCell>

// Or in incident detail view:
<Box sx={{ mt: 2 }}>
  <IncidentAcknowledgeButton
    incident={currentIncident}
    onAcknowledgeSuccess={(updated) => setCurrentIncident(updated)}
    fullWidth
  />
</Box>
```

**Location**: 
- For lists: Add as a new table column in the incident table
- For details: Add as a button in the incident action panel/header

**Data Dependencies**:
- `incident`: Individual incident object (required, available from props/state)

---

## State Management Patterns

### Using useEscalations Hook Directly

For more complex scenarios where you need fine-grained control:

```tsx
import { useEscalations } from "@/Hooks/useEscalations";

function CustomEscalationComponent() {
  const { saveEscalations, acknowledge, isLoading, error } = useEscalations();

  const handleCustomSave = async () => {
    try {
      await saveEscalations(monitorId, rules);
      // Handle success
    } catch (err) {
      // Handle error
    }
  };

  return (
    // JSX
  );
}
```

### Using SWR for Real-time Updates

If you want to refetch monitors after saving escalations:

```tsx
const { data: monitor, mutate: refetchMonitor } = useGet(
  `/monitors/${monitorId}`
);

const handleSaveSuccess = () => {
  refetchMonitor(); // Re-fetch monitor data
  onSaveSuccess?.();
};
```

---

## Validation Rules

### Client-Side Validation

The EscalationRulesDialog includes built-in validation:

1. **Delay (minutes)**:
   - Minimum: 1 minute
   - Maximum: 1440 minutes (24 hours)
   - Must be a valid number

2. **Notifications**:
   - Source notification is required
   - Escalation channel is required
   - Cannot be the same as source notification

3. **Duplicate Detection**:
   - Prevents duplicate rules with same source + channel combination
   - Displays inline error message

### Server-Side Validation

The backend (`server/src/controllers/monitorController.ts`) validates:
- Team ownership of monitor
- All notification IDs belong to the team
- Escalation format and constraints
- Monitor exists and user has permission

---

## Translation Keys Required

Add these keys to your i18n translation files:

```javascript
{
  "pages.monitor.escalations": {
    "title": "Notification Escalations",
    "description": "Configure escalation rules to send alerts to additional channels if incidents remain unacknowledged",
    "columns": {
      "notification": "Source Notification",
      "delay": "Delay (minutes)",
      "escalationChannel": "Escalation Channel",
      "actions": "Actions"
    },
    "noRules": "No escalation rules configured",
    "addRule": "Add Escalation Rule",
    "button": "Escalations",
    "savedSuccessfully": "Escalation rules saved successfully"
  },
  "pages.incidents": {
    "acknowledge": "Acknowledge",
    "acknowledged": "Acknowledged",
    "acknowledgedSuccessfully": "Incident acknowledged successfully",
    "acknowledgeDialog": {
      "title": "Acknowledge Incident",
      "message": "Are you sure you want to acknowledge this incident? This will stop any further escalations from being triggered."
    }
  },
  "common": {
    "acknowledge": "Acknowledge",
    "add": "Add",
    "cancel": "Cancel",
    "save": "Save",
    "saving": "Saving..."
  }
}
```

---

## Testing Recommendations

### Component Testing

```tsx
// Example test for EscalationSettings
import { render, screen, fireEvent } from "@testing-library/react";
import { EscalationSettings } from "@/Components/monitors/EscalationSettings";

describe("EscalationSettings", () => {
  it("opens dialog on button click", () => {
    render(
      <EscalationSettings
        monitor={mockMonitor}
        notifications={mockNotifications}
      />
    );
    
    fireEvent.click(screen.getByText(/Escalations/i));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("displays count of configured rules", () => {
    const monitorWithRules = {
      ...mockMonitor,
      escalations: [{...}, {...}]
    };
    
    render(
      <EscalationSettings
        monitor={monitorWithRules}
        notifications={mockNotifications}
      />
    );
    
    expect(screen.getByText(/Escalations \(2\)/i)).toBeInTheDocument();
  });
});
```

### Integration Testing

```tsx
// Test end-to-end escalation creation flow
describe("Escalation Rules Integration", () => {
  it("creates new escalation rule", async () => {
    const { user } = render(<MockMonitorEditPage />);
    
    // Click escalations button
    await user.click(screen.getByText(/Escalations/i));
    
    // Add new rule
    await user.click(screen.getByText(/Add Escalation Rule/i));
    await user.selectOption("source-notification", notification1.id);
    await user.selectOption("escalation-channel", notification2.id);
    await user.type(screen.getByLabelText(/Delay/i), "30");
    
    // Save
    await user.click(screen.getByRole("button", { name: /Save/i }));
    
    // Verify API call
    expect(mockApi.patch).toHaveBeenCalledWith(
      `/monitors/${monitorId}`,
      expect.objectContaining({
        escalations: expect.arrayContaining([
          { notificationId: notification1.id, delayMinutes: 30, escalationChannelId: notification2.id }
        ])
      })
    );
  });
});
```

---

## Error Handling

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Escalation channel must differ from source notification" | User selected same notification twice | Show inline error, prevent save |
| "This escalation rule already exists" | Duplicate rule detected | Highlight duplicate, suggest deletion |
| "Source notification is required" | User didn't select notification | Show field error, mark as required |
| "Failed to update escalation rules" | Backend validation or network error | Show toast error with server message |
| "Failed to acknowledge incident" | Incident not found or permission denied | Show toast error, refresh incident list |

### Error Handling in Components

```tsx
// EscalationSettings error handling
const handleSaveEscalations = async (escalations) => {
  try {
    await saveEscalations(monitor.id, escalations);
    toastSuccess("Saved successfully");
    onSaveSuccess?.();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    toastError(`Failed to save: ${message}`);
    // Error is visible to user via toast
  }
};
```

---

## Performance Considerations

### Optimization Tips

1. **Lazy Load Notifications**: Only fetch available notifications when dialog opens
   ```tsx
   const [dialogOpen, setDialogOpen] = useState(false);
   const { data: notifications } = useGet(
     dialogOpen ? "/notifications" : null
   );
   ```

2. **Memoize Components**: Prevent unnecessary re-renders
   ```tsx
   const EscalationRulesDialogMemo = React.memo(EscalationRulesDialog);
   ```

3. **Debounce Inline Edits**: If users can edit rules directly
   ```tsx
   const debouncedUpdate = useMemo(
     () => debounce(handleUpdateRule, 500),
     []
   );
   ```

4. **Cache Escalation Rules**: Use SWR options to cache rules
   ```tsx
   const { data: monitor } = useGet(`/monitors/${monitorId}`, {}, {
     revalidateOnFocus: false,
     dedupingInterval: 60000 // 1 minute
   });
   ```

---

## API Contracts

### Save Escalations

**Endpoint**: `PATCH /api/v1/monitors/{monitorId}`

**Request**:
```json
{
  "escalations": [
    {
      "notificationId": "notification-uuid",
      "delayMinutes": 30,
      "escalationChannelId": "notification-uuid"
    }
  ]
}
```

**Response** (Success):
```json
{
  "success": true,
  "msg": "Monitor updated successfully",
  "data": {
    "id": "monitor-id",
    "escalations": [...],
    ...
  }
}
```

---

### Acknowledge Incident

**Endpoint**: `PUT /api/v1/incidents/{incidentId}/acknowledge`

**Request**: Empty body `{}`

**Response** (Success):
```json
{
  "success": true,
  "msg": "Incident acknowledged successfully",
  "data": {
    "id": "incident-id",
    "acknowledged": true,
    "acknowledgedAt": "2026-01-15T10:30:00Z",
    ...
  }
}
```

---

## Migration Notes

If you're adding escalations to an existing installation:

1. **Database Migration**: Already included in backend (run on startup)
2. **Monitor Schema**: Escalations array is optional, defaults to empty
3. **Incident Schema**: New fields default to `null`/`false`
4. **Backwards Compatibility**: Existing monitors without escalations work normally
5. **Feature Flag**: Consider adding feature flag if rolling out gradually

---

## Next Steps

### Phase 2: Analytics & Monitoring

- Display escalation history on incident details
- Show escalation metrics on dashboard
- Track escalation effectiveness

### Phase 3: Advanced Features

- Escalation templates/presets
- Bulk escalation configuration
- Escalation chains (2nd level, 3rd level)
- Escalation scheduling (business hours only)

---

## Support & Debugging

### Enable Debug Logging

```tsx
// In component
import { logger } from "@/Utils/logger";

const handleSave = async () => {
  logger.debug("Saving escalations", { monitorId, escalations });
  await saveEscalations(monitorId, escalations);
};
```

### Check API Response

```tsx
// In useEscalations hook
const saveEscalations = async (monitorId, escalations) => {
  console.log("API Request:", { monitorId, escalations });
  const response = await patch(`/monitors/${monitorId}`, { escalations });
  console.log("API Response:", response);
  return response;
};
```

---

## Related Documentation

- **Backend API Docs**: `/server/openapi.json`
- **Monitor Type Definitions**: `client/src/Types/Monitor.ts`
- **Notification Type Definitions**: `client/src/Types/Notification.ts`
- **Incident Type Definitions**: `client/src/Types/Incident.ts`
- **API Hook Patterns**: `client/src/Hooks/UseApi.ts`

