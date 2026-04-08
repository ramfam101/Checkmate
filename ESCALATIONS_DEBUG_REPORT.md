# Monitor Status Update - Escalations Field Investigation

## Issue Found: Escalations Being Stripped During Entity Transformation

### The Problem

The `escalations` field is being cleared from the monitor object **during the database entity transformation**, not during the status update itself.

### Flow Analysis

#### 1. Status Update Flow (SuperSimpleQueueHelper.ts)
```typescript
// Line 162: Update monitor status
const statusChangeResult = await this.statusService.updateMonitorStatus(status, check);

// statusChangeResult.monitor contains the transformed monitor
```

#### 2. statusService.updateMonitorStatus() - [server/src/service/infrastructure/statusService.ts](server/src/service/infrastructure/statusService.ts)

**Lines 180-242 & 345-351** - Full monitor object is passed to repository:
```typescript
updateMonitorStatus = async (statusResponse, check): Promise<StatusChangeResult> => {
    // ... status logic ...
    
    // The entire monitor object is passed here (includes escalations):
    const updated = await this.monitorsRepository.updateById(monitor.id, monitor.teamId, monitor);
    
    return {
        monitor: updated,  // <-- This is the transformed result
        statusChanged,
        prevStatus,
        code,
        timestamp: Date.now(),
    };
};
```

#### 3. Repository updateById() - [server/src/repositories/monitors/MongoMonitorsRepository.ts](server/src/repositories/monitors/MongoMonitorsRepository.ts)

**Lines 169-184** - Correct save, but Missing escalations in return:
```typescript
updateById = async (monitorId: string, teamId: string, patch: Partial<Monitor>) => {
    console.log("[DEBUG] updateById - patch object escalations:", patch.escalations);
    
    const updatedMonitor = await MonitorModel.findOneAndUpdate(
        { _id: monitorId, teamId },
        {
            $set: {
                ...patch,  // <-- Includes escalations in the $set
            },
        },
        { new: true, runValidators: true }
    );
    
    console.log("[DEBUG] updateById - saved escalations:", updatedMonitor.escalations);
    return this.toEntity(updatedMonitor);  // <-- toEntity() strips out escalations!
};
```

#### 4. **THE ROOT CAUSE** - toEntity() Method [Lines 343-399](server/src/repositories/monitors/MongoMonitorsRepository.ts#L343-L399)

The `toEntity()` method does **NOT** include the `escalations` field:

```typescript
private toEntity = (doc: MonitorDocument): Monitor => {
    return {
        id: toStringId(doc._id),
        userId: toStringId(doc.userId),
        teamId: toStringId(doc.teamId),
        name: doc.name,
        description: doc.description ?? undefined,
        status: doc.status ?? "initializing",
        statusWindow: doc.statusWindow ?? [],
        // ... many other fields ...
        recentChecks: (doc.recentChecks ?? []).map((check) => this.toCheckSnapshot(check)),
        geoCheckEnabled: doc.geoCheckEnabled ?? false,
        geoCheckLocations: doc.geoCheckLocations ?? [],
        geoCheckInterval: doc.geoCheckInterval ?? 300000,
        createdAt: toDateString(doc.createdAt),
        updatedAt: toDateString(doc.updatedAt),
        // ❌ MISSING: escalations field!
    };
};
```

**Same issue in toEntityWithChecks()** [Lines 401-455](server/src/repositories/monitors/MongoMonitorsRepository.ts#L401-L455)

### Impact

1. **Database**: Escalations ARE saved correctly (the `$set` operation works)
2. **In-Memory Object**: Escalations ARE saved correctly in `updatedMonitor` from MongoDB
3. **Returned to Client**: Escalations ARE STRIPPED by `toEntity()`
4. **Result**: When `statusChangeResult.monitor` is used in Step 8 (handleEscalations), it has NO escalations field
   - Line 189 of SuperSimpleQueueHelper.ts:
   ```typescript
   if (statusChangeResult.monitor.escalations && statusChangeResult.monitor.escalations.length > 0) {
       this.handleEscalations(statusChangeResult.monitor, decision);
   }
   ```
   This check will ALWAYS fail because escalations is undefined!

### Related Code References

**Where escalations are expected:**
- [SuperSimpleQueueHelper.ts Line 189](server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts#L189) - Checks for escalations in the monitor
- [SuperSimpleQueueHelper.ts Line 485](server/src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts#L485) - Iterates through escalations

**Debug logs added (showing the issue):**
- [MongoMonitorsRepository.ts Line 170](server/src/repositories/monitors/MongoMonitorsRepository.ts#L170) - Logs patch.escalations (will show array)
- [MongoMonitorsRepository.ts Line 183](server/src/repositories/monitors/MongoMonitorsRepository.ts#L183) - Logs updatedMonitor.escalations (will show array)
- But returned monitor has no escalations!

### Solution

Add `escalations` field to both `toEntity()` and `toEntityWithChecks()` methods:

```typescript
private toEntity = (doc: MonitorDocument): Monitor => {
    // ... existing code ...
    return {
        // ... existing fields ...
        escalations: (doc.escalations ?? []).map((e) => ({
            delayMinutes: e.delayMinutes,
            channelId: toStringId(e.channelId),
        })),
        createdAt: toDateString(doc.createdAt),
        updatedAt: toDateString(doc.updatedAt),
    };
};
```
