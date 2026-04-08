# Plan: Implement Escalated Notifications for Checkmate

## Overview
Add an "Escalation Rules" section to the monitor configuration page, allowing users to define a time delay (in minutes) and separate notification channels that fire if a monitor stays down beyond that threshold.

---

## 1. Database/Model Changes

- Add two new fields to the **Monitor** model/schema:
  - `escalationAfterMinutes` (Number, default 0) — how many minutes after a monitor goes down before escalation notifications fire
  - `escalationNotificationChannels` (Array of notification channel IDs) — which notification channels to alert on escalation
- Update any validation schemas (Joi, Zod, etc.) to include these new fields.

## 2. Backend API Changes

- Update the **monitor create/update** API endpoints to accept and persist `escalationAfterMinutes` and `escalationNotificationChannels`.
- Update the **monitor GET** endpoint to return these fields so the frontend can populate them on reload.

## 3. Backend Notification/Alert Logic

- In the service that processes monitor status checks and sends alerts (likely in `Server/service/` or similar), add escalation logic:
  - When a monitor goes **down**, record the timestamp of when the incident started (this may already exist).
  - On each subsequent check where the monitor is **still down**, check if `(now - incidentStartTime) >= escalationAfterMinutes`.
  - If the threshold is met **and** an escalation notification has **not yet been sent** for this incident, send notifications to all channels in `escalationNotificationChannels`.
  - Track that the escalation was sent (e.g., a boolean flag on the incident or a timestamp) so it only fires once per incident.
  - When the monitor recovers, reset the escalation tracking.

- For the **escalation email**, use this format:
  - **Subject:** `Escalation: Monitor <name> still down`
  - **Body:** `Escalation: <monitor name> still down after <X> minutes`
  - Similar format for other channel types (Slack, Discord, webhook).

## 4. Frontend Changes (Monitor Config Page)

- Add a new **"Escalation Rules"** section to the monitor configure/edit form, placed **between** the existing "Notifications" section and the "TLS/SSL Settings" section.
- The section should have:
  - **Left side label:** "Escalation Rules" (bold heading), with subtitle: "If the monitor stays down for the specified time, notify additional channels."
  - **Right side fields:**
    - **"Escalate after (minutes)"** — a text/number input field (default value: `0`, meaning disabled)
    - **"Escalation notification channels"** — a searchable dropdown (same component used for the existing "Notifications" channel selector, i.e., "Type to search") that lets users pick from available notification channels
- Wire these fields to the monitor state so they are saved on form submit and populated on page load.

## 5. Files to Look At

Explore the codebase to find:
- `Server/db/models/Monitor.js` (or similar) — Monitor model
- `Server/validation/` — validation schemas for monitors
- `Server/controllers/monitorController.js` — create/update endpoints
- `Server/service/networkService.js` or `Server/service/notificationService.js` — where alerts are triggered
- `Client/src/Pages/Monitors/Configure/` (or similar) — the monitor config form component
- `Client/src/Components/` — reusable notification channel selector component

## 6. Testing

- Create a monitor with escalation set to 1 minute and a specific escalation notification channel.
- Take the monitored server down (suspend on Render).
- Verify: first a regular "Monitor X is down" email arrives, then ~1 minute later an "Escalation: Monitor X still down" email arrives.
- Bring the server back up and verify escalation resets (next downtime triggers fresh escalation).
- Verify the escalation settings persist when you reload the monitor config page.

## Acceptance Criteria
1. ✅ Escalation Rules UI section appears on the monitor config page (between Notifications and TLS/SSL)
2. ✅ Escalation settings are saved with the monitor and persist on reload
3. ✅ Escalation email is sent after the configured time if monitor is still down
