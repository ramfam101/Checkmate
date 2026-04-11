# Escalated Notifications Implementation Plan

## Overview
This document outlines the implementation plan for adding escalated notifications to monitors in the Checkmate project. The goal is to allow users to define escalation rules for each monitor, persist these rules in the backend, edit them in the frontend, and integrate escalation logic into the notification and incident lifecycle.

---

## 1. Data Model Changes

### Backend
- **File:** `server/src/types/monitor.ts`
  - Add an `escalationRules` field to the `Monitor` interface. Example:
    ```ts
    escalationRules?: Array<{
      delayMinutes: number; // Minutes after initial alert to escalate
      notificationChannelIds: string[]; // IDs of notification channels to use
      messageTemplate?: string; // Optional custom message
    }>;
    ```
- **File:** `server/src/db/models/Monitor.ts`
  - Update the Mongoose schema to include `escalationRules` as an array of subdocuments.
- **File:** `server/src/validation/monitorValidation.ts`
  - Update Zod schemas for monitor create/edit to validate the new `escalationRules` field.

### Frontend
- **File:** `client/src/Types/Monitor.ts`
  - Add `escalationRules` to the `Monitor` type.
- **File:** `client/src/Validation/monitor.ts`
  - Update Zod schemas for monitor forms to support `escalationRules`.

---

## 2. API Changes
- Ensure monitor create/update endpoints accept and persist `escalationRules`.
- Update OpenAPI spec (`server/openapi.json`) if present.

---

## 3. UI/UX Changes

### Monitor Create/Edit
- **File:** `client/src/Pages/CreateMonitor/index.tsx`
  - Add UI section for defining escalation rules:
    - Allow adding multiple escalation steps (delay, channels, message).
    - Use notification channels from `/notifications/team`.
    - Validate and submit escalation rules as part of monitor form.
- **File:** `client/src/Hooks/useMonitorForm.ts`
  - Add logic to handle escalation rules in form state and defaults.

### Monitor Details (Optional)
- Display escalation rules in monitor details view for transparency.

---

## 4. Notification & Incident Logic

### Backend
- **File:** `server/src/service/business/incidentService.ts`
  - On incident creation, schedule escalation notifications based on rules.
  - Track escalation state (e.g., which steps have been sent) in incident or a new collection.
- **File:** `server/src/service/infrastructure/notificationsService.ts`
  - Add logic to send escalation notifications at the correct time.
  - Ensure deduplication and correct channel targeting.

### Data Persistence
- Consider tracking escalation progress in the incident document or a new escalation-tracking collection.

---

## 5. Testing & Validation
- Update/create tests for monitor creation, update, and escalation logic.
- Test UI for adding, editing, and displaying escalation rules.
- Test notification dispatch and escalation timing.

---

## 6. Migration
- Write a migration script if needed to add `escalationRules` to existing monitors (default: empty array).

---

## 7. Affected Files Summary
- `server/src/types/monitor.ts`
- `server/src/db/models/Monitor.ts`
- `server/src/validation/monitorValidation.ts`
- `server/src/service/business/incidentService.ts`
- `server/src/service/infrastructure/notificationsService.ts`
- `client/src/Types/Monitor.ts`
- `client/src/Validation/monitor.ts`
- `client/src/Pages/CreateMonitor/index.tsx`
- `client/src/Hooks/useMonitorForm.ts`
- (Optional) `client/src/Pages/MonitorDetails/`
- (Optional) Migration script location

---

## 8. Open Questions
- Where to persist escalation state: incident doc or new collection?
- Should escalations be visible in incident history UI?
- Should escalations support custom messages per step?

---

## 9. Next Steps
1. Confirm data model and API changes.
2. Implement backend model/schema/validation updates.
3. Implement frontend type/schema/form updates.
4. Add UI for escalation rules in monitor create/edit.
5. Integrate escalation logic into incident/notification services.
6. Test end-to-end.

---

*This plan is based on the current Checkmate repo structure and code inspection as of this writing.*
