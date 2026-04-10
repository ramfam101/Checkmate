# Escalation Feature - Quick Start Guide

**For**: Frontend Developers  
**Status**: Ready for Integration  
**Time to Integrate**: ~2-4 hours  
**Difficulty**: Medium

---

## What You Need to Know (2 min read)

The escalation feature allows monitors to automatically send alerts to backup notification channels if incidents aren't acknowledged within a specified time.

**Example**: Email → Slack after 30 min of no acknowledgment

**Backend Status**: ✅ Complete and running  
**Your Job**: Integrate UI components and wire up API calls

---

## Quick Integration Steps

### Step 1: Monitor Page - Add Escalations Section (30 min)

**File**: `client/src/Pages/CreateMonitor/index.tsx`

```tsx
// 1. Add import at top
import { EscalationSettings } from "@/Components/monitors/EscalationSettings";

// 2. In component, get notifications data
const { data: availableNotifications } = useGet("/notifications");

// 3. In JSX form, add section (after notifications section):
<ConfigBox
  title={t("pages.createMonitor.form.escalations.title")}
  subtitle={t("pages.createMonitor.form.escalations.description")}
>
  <EscalationSettings
    monitor={existingMonitor}
    notifications={availableNotifications || []}
    onSaveSuccess={() => refetchMonitor()}
  />
</ConfigBox>
```

**That's it!** The component handles the dialog, API calls, and error handling.

### Step 2: Incident Page - Add Acknowledge Button (20 min)

**File**: `client/src/Pages/Incidents/index.tsx` (or equivalent)

```tsx
// 1. Add import at top
import { IncidentAcknowledgeButton } from "@/Components/incidents/IncidentAcknowledgeButton";

// 2. In incident table, add button column:
<TableCell align="center">
  <IncidentAcknowledgeButton
    incident={incident}
    onAcknowledgeSuccess={(updated) => {
      refetchIncidents(); // Refresh list after acknowledge
    }}
    size="small"
  />
</TableCell>

// OR in incident detail view:
<Box sx={{ mt: 2 }}>
  <IncidentAcknowledgeButton
    incident={currentIncident}
    onAcknowledgeSuccess={(acknowledged) => {
      setCurrentIncident(acknowledged);
    }}
    fullWidth
  />
</Box>
```

**That's it!** The button handles confirmation dialog and API calls.

### Step 3: Add Translation Keys (15 min)

**File**: `client/src/locales/en.json` (or equivalent)

```json
{
  "pages": {
    "createMonitor": {
      "form": {
        "escalations": {
          "title": "Notification Escalations",
          "description": "Configure escalation rules to send alerts to additional channels if incidents remain unacknowledged"
        }
      }
    },
    "monitor": {
      "escalations": {
        "title": "Notification Escalations",
        "description": "Configure escalation rules to send alerts to additional channels if incidents remain unacknowledged",
        "noRules": "No escalation rules configured",
        "addRule": "Add Escalation Rule",
        "button": "Escalations",
        "savedSuccessfully": "Escalation rules saved successfully",
        "columns": {
          "notification": "Source Notification",
          "delay": "Delay (minutes)",
          "escalationChannel": "Escalation Channel",
          "actions": "Actions"
        }
      }
    },
    "incidents": {
      "acknowledge": "Acknowledge",
      "acknowledged": "Acknowledged",
      "acknowledgedSuccessfully": "Incident acknowledged successfully",
      "acknowledgeDialog": {
        "title": "Acknowledge Incident",
        "message": "Are you sure you want to acknowledge this incident? This will stop any further escalations from being triggered."
      }
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

### Step 4: Test Your Integration (45 min)

**Checklist**:

- [ ] Monitor edit page shows "Escalations" button
- [ ] Clicking button opens dialog
- [ ] Can add escalation rule (source + channel + delay)
- [ ] Validation prevents invalid rules
- [ ] Clicking Save triggers API call
- [ ] Success toast appears
- [ ] Incident page shows "Acknowledge" button
- [ ] Clicking button shows confirmation dialog
- [ ] Confirming calls API and refreshes incident
- [ ] Acknowledged incidents show disabled button

**Test Data**:
1. Create a monitor with 2 email notifications
2. Add escalation rule: notification1 → notification2 after 5 minutes
3. Click Save and verify in browser console (Network tab)
4. Check API response shows rule was saved

---

## Files You're Using

### Components (Use as-is, no changes needed)

1. **EscalationRulesDialog** - `client/src/Components/monitors/EscalationRulesDialog.tsx`
   - Full UI for managing rules
   - Built-in validation
   - No customization needed

2. **EscalationSettings** - `client/src/Components/monitors/EscalationSettings.tsx`
   - Wrapper that opens dialog
   - Handles API calls
   - No customization needed

3. **IncidentAcknowledgeButton** - `client/src/Components/incidents/IncidentAcknowledgeButton.tsx`
   - Ready-to-use button
   - Confirmation dialog included
   - No customization needed

### Hook (Use for custom implementations)

**useEscalations** - `client/src/Hooks/useEscalations.ts`
```tsx
const { saveEscalations, acknowledge, isLoading, error } = useEscalations();

// Save escalation rules
await saveEscalations(monitorId, [
  { notificationId: "1", delayMinutes: 30, escalationChannelId: "2" }
]);

// Acknowledge incident
await acknowledge(incidentId);
```

### Types (Already updated)

- [client/src/Types/Monitor.ts](../client/src/Types/Monitor.ts) - Includes `escalations` field
- [client/src/Types/Incident.ts](../client/src/Types/Incident.ts) - Includes escalation tracking

---

## Common Questions

### Q: How do I get the list of available notifications?

```tsx
import { useGet } from "@/Hooks/UseApi";

// Fetch notifications
const { data: notifications } = useGet("/notifications");

// Pass to component
<EscalationSettings notifications={notifications || []} />
```

### Q: The button isn't responding, what's wrong?

**Check**:
1. Is component imported? `import { ... } from "@/Components/..."`
2. Is monitor/incident data passed correctly?
3. Check browser console for errors
4. Check Network tab - is API call being made?

### Q: I want to customize the button appearance

```tsx
// EscalationSettings accepts standard MUI button props via wrapper
// For EscalationRulesDialog, it uses custom styles (not customizable)
// For IncidentAcknowledgeButton:

<IncidentAcknowledgeButton
  incident={incident}
  variant="text"        // contained | outlined | text
  size="large"          // small | medium | large
  fullWidth             // boolean
/>
```

### Q: How do I test without real incidents?

**Option 1**: Use MongoDB directly
```bash
# SSH into MongoDB container
# Insert test incident:
db.incidents.insertOne({
  monitorId: ObjectId("..."),
  teamId: ObjectId("..."),
  startTime: new Date(Date.now() - 31 * 60000),  // 31 min ago
  status: true,
  acknowledged: false
})
```

**Option 2**: Use API to create incident
```bash
curl -X POST http://localhost:52345/api/v1/incidents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"monitorId":"...","startTime":"2026-01-15T10:00:00Z"}'
```

### Q: What if escalation channels aren't showing?

**Checklist**:
1. Are notifications created in admin panel?
2. Are they assigned to same team as monitor?
3. Check `useGet("/notifications")` returns data
4. Check browser console for errors

### Q: Can I style the dialog?

**EscalationRulesDialog** uses Material-UI components, so:
- Standard MUI customization works
- Override via theme if needed
- Core styles shouldn't be changed

### Q: How do I add more fields to escalation rules?

**Currently Supported**:
- `notificationId` (which channel to escalate from)
- `delayMinutes` (how long to wait)
- `escalationChannelId` (which channel to escalate to)

**To Add New Field**:
1. Update backend types: `server/src/types/monitor.ts`
2. Update database schema: `server/src/db/models/Monitor.ts`
3. Update frontend type: `client/src/Types/Monitor.ts`
4. Update EscalationRulesDialog UI
5. Update validation logic

---

## API Errors & Debugging

### Error: "Escalation channel must differ from source notification"

**Cause**: User tried to escalate from notification A to notification A

**Fix**: Validate in dialog (already done), or in backend error handling

### Error: "This escalation rule already exists"

**Cause**: User added duplicate rule

**Fix**: Check before adding, toastError will show message

### Error: "Failed to update escalation rules"

**Cause**: 
- Network error
- Server validation failed
- Permission denied

**Debug**:
```javascript
// In browser console:
// 1. Check Network tab for PATCH request
// 2. Look at response body for error message
// 3. Check server logs on backend
```

### Error: Toast shows but nothing updates

**Cause**: Success toast shown but data didn't update

**Fix**: 
```tsx
// Ensure onSaveSuccess callback is being called:
<EscalationSettings
  {...props}
  onSaveSuccess={() => {
    console.log("Save successful!");
    refetchMonitor();  // This is critical
  }}
/>
```

---

## Performance Tips

1. **Lazy Load Notifications**: Only fetch when dialog opens
   ```tsx
   const [dialogOpen, setDialogOpen] = useState(false);
   const { data: notifications } = useGet(
     dialogOpen ? "/notifications" : null
   );
   ```

2. **Debounce Dialog**: Prevent multiple opens
   ```tsx
   const [dialogOpen, setDialogOpen] = useState(false);
   const handleOpen = useCallback(() => setDialogOpen(true), []);
   ```

3. **Memoize Components**: If rendering many incidents
   ```tsx
   const ButtonMemo = React.memo(IncidentAcknowledgeButton);
   ```

---

## Testing Checklist

Before submitting PR:

- [ ] Components render without console errors
- [ ] TypeScript types compile (`npm run build` in client)
- [ ] Translation keys exist and show correctly
- [ ] Escalation rules can be added/edited/deleted
- [ ] API calls appear in Network tab
- [ ] Success/error toasts display
- [ ] Button states (loading, disabled) work correctly
- [ ] Dialog closes after save
- [ ] Acknowledge button works on incidents
- [ ] Mobile responsive (scale down browser)

---

## File Locations Reference

| Need | File |
|------|------|
| Monitor edit page | `client/src/Pages/CreateMonitor/index.tsx` |
| Incident list page | `client/src/Pages/Incidents/index.tsx` |
| Translation keys | `client/src/locales/en.json` |
| Escalation dialog | `client/src/Components/monitors/EscalationRulesDialog.tsx` |
| Acknowledge button | `client/src/Components/incidents/IncidentAcknowledgeButton.tsx` |
| Custom hook | `client/src/Hooks/useEscalations.ts` |
| Type definitions | `client/src/Types/Monitor.ts` and `Incident.ts` |

---

## Next Steps After Integration

1. **Test with Real Data**
   - Create real monitor
   - Configure escalation rule
   - Wait for incident (or simulate)
   - Verify escalation notification sent

2. **Collect Feedback**
   - Get user feedback on UI/UX
   - Document any issues
   - Plan improvements

3. **Advanced Features** (Phase 2)
   - Escalation history timeline
   - Analytics dashboard
   - Multi-level escalations

---

## Need Help?

1. **Component Not Showing**: Check imports and console errors
2. **API Not Called**: Check browser Network tab and backend logs
3. **Data Not Saving**: Check `onSaveSuccess` callback in component
4. **Types Wrong**: Run `npm run build` to see TypeScript errors
5. **Still Stuck**: Review [ESCALATION_FRONTEND_INTEGRATION.md](../client/src/ESCALATION_FRONTEND_INTEGRATION.md) for detailed docs

---

**Ready to integrate?** Start with Step 1 and follow the checklist. Good luck! 🚀

