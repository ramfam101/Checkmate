# =============================================================
# Checkmate – Escalation Notifications patch
# Run from:  C:\Users\tyler\Checkmate
#   powershell -ExecutionPolicy Bypass -File apply-escalation.ps1
# =============================================================

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Applying Escalation Notifications patch..." -ForegroundColor Cyan

# ── 1. server/src/types/monitor.ts ───────────────────────────
$monitorTypes = Get-Content "server\src\types\monitor.ts" -Raw

$oldInterface = @'
export interface Monitor {
        id: string;
        userId: string;
        teamId: string;
'@

$newInterface = @'
export interface EscalationRule {
        notification: string;   // notification ID (DB shape)
        delayMinutes: number;
}

export interface Monitor {
        id: string;
        userId: string;
        teamId: string;
'@

if ($monitorTypes -notlike "*EscalationRule*") {
    $monitorTypes = $monitorTypes.Replace($oldInterface, $newInterface)

    # Add escalationRules field before closing brace of Monitor interface
    $monitorTypes = $monitorTypes.Replace(
        "        createdAt: string;`r`n        updatedAt: string;`r`n}",
        "        escalationRules?: EscalationRule[];`r`n        createdAt: string;`r`n        updatedAt: string;`r`n}"
    )
    $monitorTypes = $monitorTypes.Replace(
        "        createdAt: string;`n        updatedAt: string;`n}",
        "        escalationRules?: EscalationRule[];`n        createdAt: string;`n        updatedAt: string;`n}"
    )
    Set-Content "server\src\types\monitor.ts" $monitorTypes -NoNewline
    Write-Host "  [OK] server/src/types/monitor.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] server/src/types/monitor.ts already patched" -ForegroundColor Yellow
}

# ── 2. server/src/db/models/Monitor.ts ───────────────────────
$monitorModel = Get-Content "server\src\db\models\Monitor.ts" -Raw

$oldRecentChecks = @'
                recentChecks: {
                        type: [checkSnapshotSchema],
                        default: [],
                },
        },
        {
                timestamps: true,
        }
'@

$newRecentChecks = @'
                recentChecks: {
                        type: [checkSnapshotSchema],
                        default: [],
                },
                escalationRules: {
                        type: [
                                {
                                        notification: { type: Schema.Types.ObjectId, ref: "Notification", required: true },
                                        delayMinutes: { type: Number, required: true, min: 1 },
                                },
                        ],
                        default: [],
                },
        },
        {
                timestamps: true,
        }
'@

if ($monitorModel -notlike "*escalationRules*") {
    $monitorModel = $monitorModel.Replace($oldRecentChecks, $newRecentChecks)
    Set-Content "server\src\db\models\Monitor.ts" $monitorModel -NoNewline
    Write-Host "  [OK] server/src/db/models/Monitor.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] server/src/db/models/Monitor.ts already patched" -ForegroundColor Yellow
}

# ── 3. server/src/repositories/monitors/MongoMonitorsRepository.ts ──
$repo = Get-Content "server\src\repositories\monitors\MongoMonitorsRepository.ts" -Raw

$oldToEntity = "                        geoCheckInterval: doc.geoCheckInterval ?? 300000,`r`n                        createdAt: toDateString(doc.createdAt),`r`n                        updatedAt: toDateString(doc.updatedAt),`r`n                };`r`n        };`r`n`r`n        private toEntityWithChecks"
$newToEntity = "                        geoCheckInterval: doc.geoCheckInterval ?? 300000,`r`n                        escalationRules: (doc.escalationRules ?? []).map((r: { notification: unknown; delayMinutes: number }) => ({`r`n                                notification: toStringId(r.notification),`r`n                                delayMinutes: r.delayMinutes,`r`n                        })),`r`n                        createdAt: toDateString(doc.createdAt),`r`n                        updatedAt: toDateString(doc.updatedAt),`r`n                };`r`n        };`r`n`r`n        private toEntityWithChecks"

$oldToEntityLF = "                        geoCheckInterval: doc.geoCheckInterval ?? 300000,`n                        createdAt: toDateString(doc.createdAt),`n                        updatedAt: toDateString(doc.updatedAt),`n                };`n        };`n`n        private toEntityWithChecks"
$newToEntityLF = "                        geoCheckInterval: doc.geoCheckInterval ?? 300000,`n                        escalationRules: (doc.escalationRules ?? []).map((r: { notification: unknown; delayMinutes: number }) => ({`n                                notification: toStringId(r.notification),`n                                delayMinutes: r.delayMinutes,`n                        })),`n                        createdAt: toDateString(doc.createdAt),`n                        updatedAt: toDateString(doc.updatedAt),`n                };`n        };`n`n        private toEntityWithChecks"

if ($repo -notlike "*escalationRules*") {
    if ($repo -like "*`r`n*") {
        $repo = $repo.Replace($oldToEntity, $newToEntity)
    } else {
        $repo = $repo.Replace($oldToEntityLF, $newToEntityLF)
    }
    Set-Content "server\src\repositories\monitors\MongoMonitorsRepository.ts" $repo -NoNewline
    Write-Host "  [OK] server/src/repositories/monitors/MongoMonitorsRepository.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] MongoMonitorsRepository.ts already patched" -ForegroundColor Yellow
}

# ── 4. server/src/validation/monitorValidation.ts ────────────
$validation = Get-Content "server\src\validation\monitorValidation.ts" -Raw

$escalationRuleSchema = @'
const escalationRuleSchema = z.object({
        notificationId: z.string().min(1),
        delayMinutes: z.number().int().min(1),
});

'@

$oldCreate = "export const createMonitorBodyValidation = z.object({"
$newCreate = $escalationRuleSchema + "export const createMonitorBodyValidation = z.object({"

$addEscalationCreate = "        geoCheckInterval: z.number().min(300000).optional(),`r`n});"
$addEscalationCreateNew = "        geoCheckInterval: z.number().min(300000).optional(),`r`n        escalationRules: z.array(escalationRuleSchema).optional(),`r`n});"

$addEscalationCreateLF = "        geoCheckInterval: z.number().min(300000).optional(),`n});"
$addEscalationCreateNewLF = "        geoCheckInterval: z.number().min(300000).optional(),`n        escalationRules: z.array(escalationRuleSchema).optional(),`n});"

if ($validation -notlike "*escalationRuleSchema*") {
    $validation = $validation.Replace($oldCreate, $newCreate)

    # Add to createMonitorBodyValidation (first occurrence)
    $firstIdx = $validation.IndexOf($addEscalationCreate)
    if ($firstIdx -ge 0) {
        $validation = $validation.Substring(0, $firstIdx) + $addEscalationCreateNew + $validation.Substring($firstIdx + $addEscalationCreate.Length)
    } else {
        $firstIdx = $validation.IndexOf($addEscalationCreateLF)
        if ($firstIdx -ge 0) {
            $validation = $validation.Substring(0, $firstIdx) + $addEscalationCreateNewLF + $validation.Substring($firstIdx + $addEscalationCreateLF.Length)
        }
    }

    # Add to editMonitorBodyValidation (second occurrence)
    $secondIdx = $validation.IndexOf($addEscalationCreate)
    if ($secondIdx -ge 0) {
        $validation = $validation.Substring(0, $secondIdx) + $addEscalationCreateNew + $validation.Substring($secondIdx + $addEscalationCreate.Length)
    } else {
        $secondIdx = $validation.IndexOf($addEscalationCreateLF)
        if ($secondIdx -ge 0) {
            $validation = $validation.Substring(0, $secondIdx) + $addEscalationCreateNewLF + $validation.Substring($secondIdx + $addEscalationCreateLF.Length)
        }
    }

    Set-Content "server\src\validation\monitorValidation.ts" $validation -NoNewline
    Write-Host "  [OK] server/src/validation/monitorValidation.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] server/src/validation/monitorValidation.ts already patched" -ForegroundColor Yellow
}

# ── 5. server/src/controllers/monitorController.ts ───────────
$controller = Get-Content "server\src\controllers\monitorController.ts" -Raw

$oldCreate = @'
        createMonitor = async (req: Request, res: Response, next: NextFunction) => {
                try {
                        const validatedBody = createMonitorBodyValidation.parse(req.body);

                        const userId = requireUserId(req.user?.id);
                        const teamId = requireTeamId(req.user?.teamId);

                        const monitor = await this.monitorService.createMonitor(teamId, userId, validatedBody);
'@

$newCreate = @'
        createMonitor = async (req: Request, res: Response, next: NextFunction) => {
                try {
                        const validatedBody = createMonitorBodyValidation.parse(req.body);

                        const userId = requireUserId(req.user?.id);
                        const teamId = requireTeamId(req.user?.teamId);

                        // Validate escalation notification IDs belong to this team
                        if (validatedBody.escalationRules && validatedBody.escalationRules.length > 0) {
                                const teamNotifications = await this.notificationsService.findNotificationsByTeamId(teamId);
                                const validIds = teamNotifications.map((n) => n.id);
                                const invalidIds = validatedBody.escalationRules
                                        .map((r) => r.notificationId)
                                        .filter((id) => !validIds.includes(id));
                                if (invalidIds.length > 0) {
                                        throw new AppError({
                                                message: `Invalid escalation notification IDs: ${invalidIds.join(", ")}`,
                                                status: 403,
                                        });
                                }
                                // Transform frontend shape { notificationId, delayMinutes } -> DB shape { notification, delayMinutes }
                                (validatedBody as Record<string, unknown>).escalationRules = validatedBody.escalationRules.map((r) => ({
                                        notification: r.notificationId,
                                        delayMinutes: r.delayMinutes,
                                }));
                        }

                        const monitor = await this.monitorService.createMonitor(teamId, userId, validatedBody);
'@

$oldEdit = @'
        editMonitor = async (req: Request, res: Response, next: NextFunction) => {
                try {
                        const validatedParams = getMonitorByIdParamValidation.parse(req.params);
                        const validatedBody = editMonitorBodyValidation.parse(req.body);
                        const monitorId = validatedParams.monitorId;
                        const teamId = requireTeamId(req.user?.teamId);

                        const editedMonitor = await this.monitorService.editMonitor({ teamId, monitorId, body: validatedBody });
'@

$newEdit = @'
        editMonitor = async (req: Request, res: Response, next: NextFunction) => {
                try {
                        const validatedParams = getMonitorByIdParamValidation.parse(req.params);
                        const validatedBody = editMonitorBodyValidation.parse(req.body);
                        const monitorId = validatedParams.monitorId;
                        const teamId = requireTeamId(req.user?.teamId);

                        // Validate escalation notification IDs belong to this team
                        if (validatedBody.escalationRules && validatedBody.escalationRules.length > 0) {
                                const teamNotifications = await this.notificationsService.findNotificationsByTeamId(teamId);
                                const validIds = teamNotifications.map((n) => n.id);
                                const invalidIds = validatedBody.escalationRules
                                        .map((r) => r.notificationId)
                                        .filter((id) => !validIds.includes(id));
                                if (invalidIds.length > 0) {
                                        throw new AppError({
                                                message: `Invalid escalation notification IDs: ${invalidIds.join(", ")}`,
                                                status: 403,
                                        });
                                }
                                // Transform frontend shape { notificationId, delayMinutes } -> DB shape { notification, delayMinutes }
                                (validatedBody as Record<string, unknown>).escalationRules = validatedBody.escalationRules.map((r) => ({
                                        notification: r.notificationId,
                                        delayMinutes: r.delayMinutes,
                                }));
                        }

                        const editedMonitor = await this.monitorService.editMonitor({ teamId, monitorId, body: validatedBody });
'@

if ($controller -notlike "*escalationRules*") {
    $controller = $controller.Replace($oldCreate, $newCreate)
    $controller = $controller.Replace($oldEdit, $newEdit)
    Set-Content "server\src\controllers\monitorController.ts" $controller -NoNewline
    Write-Host "  [OK] server/src/controllers/monitorController.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] server/src/controllers/monitorController.ts already patched" -ForegroundColor Yellow
}

# ── 6. server/src/service/infrastructure/notificationsService.ts ──
$notifService = Get-Content "server\src\service\infrastructure\notificationsService.ts" -Raw

$oldInterface = @'
export interface INotificationsService {
        createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
        findById: (id: string, teamId: string) => Promise<Notification>;
        findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
        updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
        deleteById: (id: string, teamId: string) => Promise<Notification>;
        handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;

        sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
        testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}
'@

$newInterface = @'
export interface INotificationsService {
        createNotification: (notificationData: Partial<Notification>, userId: string, teamId: string) => Promise<Notification>;
        findById: (id: string, teamId: string) => Promise<Notification>;
        findNotificationsByTeamId: (teamId: string) => Promise<Notification[]>;
        updateById(id: string, teamId: string, updateData: Partial<Notification>): Promise<Notification>;
        deleteById: (id: string, teamId: string) => Promise<Notification>;
        handleNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => Promise<boolean>;
        scheduleEscalationNotifications: (monitor: Monitor, monitorStatusResponse: MonitorStatusResponse, decision: MonitorActionDecision) => void;
        cancelEscalationNotifications: (monitorId: string) => void;

        sendTestNotification: (notification: Partial<Notification>) => Promise<boolean>;
        testAllNotifications: (notificationIds: string[]) => Promise<boolean>;
}
'@

$oldDeleteById = @'
        deleteById = async (id: string, teamId: string): Promise<Notification> => {
                const deleted = await this.notificationsRepository.deleteById(id, teamId);
                await this.monitorsRepository.removeNotificationFromMonitors(id);
                return deleted;
        };
}
'@

$newDeleteById = @'
        deleteById = async (id: string, teamId: string): Promise<Notification> => {
                const deleted = await this.notificationsRepository.deleteById(id, teamId);
                await this.monitorsRepository.removeNotificationFromMonitors(id);
                return deleted;
        };

        // ── Escalation scheduling ─────────────────────────────────────
        // In-memory map: monitorId -> array of NodeJS.Timeout handles
        private escalationTimers: Map<string, ReturnType<typeof setTimeout>[]> = new Map();

        scheduleEscalationNotifications = (
                monitor: Monitor,
                monitorStatusResponse: MonitorStatusResponse,
                decision: MonitorActionDecision
        ): void => {
                const rules = (monitor as unknown as { escalationRules?: { notification: string; delayMinutes: number }[] }).escalationRules;
                if (!rules || rules.length === 0) return;

                // Cancel any existing timers for this monitor first
                this.cancelEscalationNotifications(monitor.id);

                const timers: ReturnType<typeof setTimeout>[] = [];

                for (const rule of rules) {
                        const delayMs = rule.delayMinutes * 60 * 1000;
                        const timer = setTimeout(async () => {
                                try {
                                        // Re-fetch monitor to confirm it is still down
                                        const current = await this.monitorsRepository.findById(monitor.id, monitor.teamId);
                                        if (current.status !== "down") return;

                                        const notification = await this.notificationsRepository.findById(rule.notification, monitor.teamId);
                                        if (!notification) return;

                                        const settings = this.settingsService.getSettings();
                                        const clientHost = settings.clientHost || "Host not defined";
                                        const message = this.notificationMessageBuilder.buildMessage(
                                                monitor,
                                                monitorStatusResponse,
                                                decision,
                                                clientHost
                                        );

                                        // Mark as escalation so email provider can prefix subject
                                        if (message?.metadata) {
                                                (message.metadata as Record<string, unknown>).escalation = true;
                                        }

                                        await this.emailProvider.sendMessage!(notification, message!);

                                        this.logger.info({
                                                message: `Escalation email sent for monitor ${monitor.id} after ${rule.delayMinutes} min`,
                                                service: SERVICE_NAME,
                                                method: "scheduleEscalationNotifications",
                                        });
                                } catch (err) {
                                        this.logger.error({
                                                message: `Escalation send failed for monitor ${monitor.id}: ${err instanceof Error ? err.message : String(err)}`,
                                                service: SERVICE_NAME,
                                                method: "scheduleEscalationNotifications",
                                        });
                                }
                        }, delayMs);

                        timers.push(timer);
                }

                this.escalationTimers.set(monitor.id, timers);

                this.logger.info({
                        message: `Scheduled ${timers.length} escalation timer(s) for monitor ${monitor.id}`,
                        service: SERVICE_NAME,
                        method: "scheduleEscalationNotifications",
                });
        };

        cancelEscalationNotifications = (monitorId: string): void => {
                const timers = this.escalationTimers.get(monitorId);
                if (timers && timers.length > 0) {
                        timers.forEach((t) => clearTimeout(t));
                        this.escalationTimers.delete(monitorId);
                        this.logger.info({
                                message: `Cancelled escalation timers for monitor ${monitorId}`,
                                service: SERVICE_NAME,
                                method: "cancelEscalationNotifications",
                        });
                }
        };
}
'@

if ($notifService -notlike "*scheduleEscalationNotifications*") {
    $notifService = $notifService.Replace($oldInterface, $newInterface)
    $notifService = $notifService.Replace($oldDeleteById, $newDeleteById)
    Set-Content "server\src\service\infrastructure\notificationsService.ts" $notifService -NoNewline
    Write-Host "  [OK] server/src/service/infrastructure/notificationsService.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] notificationsService.ts already patched" -ForegroundColor Yellow
}

# ── 7. SuperSimpleQueueHelper.ts – hook escalation into heartbeat ──
$queueHelper = Get-Content "server\src\service\infrastructure\SuperSimpleQueue\SuperSimpleQueueHelper.ts" -Raw

$oldStep6 = @'
                                // Step 6. Handle notifications (best effort, continue even in event of failure, don't wait)
                                if (decision.shouldSendNotification) {
                                        this.notificationsService.handleNotifications(statusChangeResult.monitor, status, decision).catch((error: unknown) => {
                                                this.logger.error({
                                                        message: `Error sending notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                                                        service: SERVICE_NAME,
                                                        method: "getMonitorJob",
                                                        stack: error instanceof Error ? error.stack : undefined,
                                                });
                                        });
                                }
'@

$newStep6 = @'
                                // Step 6. Handle notifications (best effort, continue even in event of failure, don't wait)
                                if (decision.shouldSendNotification) {
                                        this.notificationsService.handleNotifications(statusChangeResult.monitor, status, decision).catch((error: unknown) => {
                                                this.logger.error({
                                                        message: `Error sending notifications for job ${statusChangeResult.monitor.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                                                        service: SERVICE_NAME,
                                                        method: "getMonitorJob",
                                                        stack: error instanceof Error ? error.stack : undefined,
                                                });
                                        });

                                        // Step 6b. Handle escalation scheduling
                                        if (statusChangeResult.monitor.status === "down") {
                                                // Monitor just went down – schedule escalation alerts
                                                this.notificationsService.scheduleEscalationNotifications(statusChangeResult.monitor, status, decision);
                                        } else if (
                                                statusChangeResult.monitor.status === "up" &&
                                                (statusChangeResult.prevStatus === "down" || statusChangeResult.prevStatus === "breached")
                                        ) {
                                                // Monitor recovered – cancel any pending escalation alerts
                                                this.notificationsService.cancelEscalationNotifications(statusChangeResult.monitor.id);
                                        }
                                }
'@

if ($queueHelper -notlike "*scheduleEscalationNotifications*") {
    $queueHelper = $queueHelper.Replace($oldStep6, $newStep6)
    Set-Content "server\src\service\infrastructure\SuperSimpleQueue\SuperSimpleQueueHelper.ts" $queueHelper -NoNewline
    Write-Host "  [OK] SuperSimpleQueueHelper.ts" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] SuperSimpleQueueHelper.ts already patched" -ForegroundColor Yellow
}

# ── 8. client/src/Components/EscalationRulesEditor.tsx (new file) ──
$escalationEditor = @'
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import { Trash2, Plus } from "lucide-react";
import { useTheme } from "@mui/material/styles";
import { Select, TextField, Button } from "@/Components/inputs";
import type { Notification } from "@/Types/Notification";

export interface EscalationRule {
  notificationId: string;
  delayMinutes: number;
}

interface Props {
  value: EscalationRule[];
  onChange: (rules: EscalationRule[]) => void;
  notifications: Notification[];
}

export const EscalationRulesEditor = ({ value, onChange, notifications }: Props) => {
  const theme = useTheme();

  const addRule = () => {
    onChange([...value, { notificationId: "", delayMinutes: 30 }]);
  };

  const removeRule = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, patch: Partial<EscalationRule>) => {
    onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <Stack spacing={theme.spacing(3)}>
      {value.map((rule, index) => (
        <Stack
          key={index}
          direction="row"
          alignItems="flex-end"
          spacing={theme.spacing(2)}
        >
          <Select
            value={rule.notificationId}
            onChange={(e) => updateRule(index, { notificationId: e.target.value as string })}
            fieldLabel={index === 0 ? "Notification" : undefined}
            placeholder="Select notification"
            sx={{ minWidth: 200, flexGrow: 1 }}
          >
            {notifications.map((n) => (
              <MenuItem key={n.id} value={n.id}>
                {n.notificationName}
              </MenuItem>
            ))}
          </Select>

          <TextField
            type="number"
            value={rule.delayMinutes}
            onChange={(e) =>
              updateRule(index, { delayMinutes: Math.max(1, Number(e.target.value)) })
            }
            fieldLabel={index === 0 ? "Delay (minutes)" : undefined}
            sx={{ width: 140 }}
            inputProps={{ min: 1 }}
          />

          <IconButton
            size="small"
            onClick={() => removeRule(index)}
            aria-label="Remove escalation rule"
            sx={{ mb: 0.5 }}
          >
            <Trash2 size={16} />
          </IconButton>
        </Stack>
      ))}

      <Stack direction="row">
        <Button
          variant="outlined"
          onClick={addRule}
          startIcon={<Plus size={16} />}
        >
          Add escalation rule
        </Button>
      </Stack>

      {value.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No escalation rules configured. Add a rule to send follow-up alerts if the monitor stays down.
        </Typography>
      )}
    </Stack>
  );
};
'@

if (-not (Test-Path "client\src\Components\EscalationRulesEditor.tsx")) {
    Set-Content "client\src\Components\EscalationRulesEditor.tsx" $escalationEditor -NoNewline
    Write-Host "  [OK] client/src/Components/EscalationRulesEditor.tsx (created)" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] EscalationRulesEditor.tsx already exists" -ForegroundColor Yellow
}

# ── 9. Inject EscalationRulesEditor into CreateMonitor/index.tsx ──
$createMonitor = Get-Content "client\src\Pages\CreateMonitor\index.tsx" -Raw

$oldImports = 'import type { MonitorFormData } from "@/Validation/monitor";'
$newImports = @'
import type { MonitorFormData } from "@/Validation/monitor";
import { EscalationRulesEditor } from "@/Components/EscalationRulesEditor";
'@

$oldSaveButton = @'
        <Stack
                        direction="row"
                        justifyContent="flex-end"
                >
                        <Button
                                loading={isSubmitting}
                                type="submit"
                                variant="contained"
                                color="primary"
                        >
                                {t("common.buttons.save")}
                        </Button>
                </Stack>
'@

$newSaveButton = @'
        <ConfigBox
                        title="Escalation Alerts"
                        subtitle="Send follow-up email alerts if the monitor stays down for a specified duration."
                        rightContent={
                                <Controller
                                        name="escalationRules"
                                        control={control}
                                        render={({ field }) => (
                                                <EscalationRulesEditor
                                                        value={field.value ?? []}
                                                        onChange={field.onChange}
                                                        notifications={notifications ?? []}
                                                />
                                        )}
                                />
                        }
                />

                <Stack
                        direction="row"
                        justifyContent="flex-end"
                >
                        <Button
                                loading={isSubmitting}
                                type="submit"
                                variant="contained"
                                color="primary"
                        >
                                {t("common.buttons.save")}
                        </Button>
                </Stack>
'@

if ($createMonitor -notlike "*EscalationRulesEditor*") {
    $createMonitor = $createMonitor.Replace($oldImports, $newImports)
    $createMonitor = $createMonitor.Replace($oldSaveButton, $newSaveButton)
    Set-Content "client\src\Pages\CreateMonitor\index.tsx" $createMonitor -NoNewline
    Write-Host "  [OK] client/src/Pages/CreateMonitor/index.tsx" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] CreateMonitor/index.tsx already patched" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "All done! Restart your server and client:" -ForegroundColor Cyan
Write-Host "  cd server && npm run dev" -ForegroundColor White
Write-Host "  cd client && npm run dev" -ForegroundColor White
