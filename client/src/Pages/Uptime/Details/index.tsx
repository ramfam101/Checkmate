import { BasePage } from "@/Components/design-elements";
import { HeaderTimeRange } from "@/Components/common";
import Stack from "@mui/material/Stack";
import {
	HistogramStatus,
	RadialAvgResponse,
	HistogramDetails,
	HeaderMonitorControls,
	HeaderGeoTabs,
	GeoChecksMap,
} from "@/Components/monitors";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { ChecksTable } from "@/Pages/Uptime/Details/Components/ChecksTable";
import { GeoChecksTable } from "@/Pages/Uptime/Details/Components/GeoChecksTable";
import { MonitorStatBoxes } from "@/Components/monitors";

import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
// Divider not used
import { Trash2 } from "lucide-react";
import { Button } from "@/Components/inputs";
import { type Monitor } from "@/Types/Monitor";
import { useIsAdmin } from "@/Hooks/useIsAdmin";
import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { usePatch } from "@/Hooks/UseApi";
import { useSelector } from "react-redux";
import { useGet } from "@/Hooks/UseApi";
import { type MonitorDetailsResponse, supportsGeoCheck } from "@/Types/Monitor";
import type { ChecksResponse } from "@/Types/Check";
import type {
	GeoChecksResult,
	FlatGeoChecksResponse,
	GeoContinent,
} from "@/Types/GeoCheck";
import type { RootState } from "@/Types/state";
import type { Notification } from "@/Types/Notification";
import { formatDateWithTz } from "@/Utils/TimeUtils";
import { t } from "i18next";
import { Typography } from "@mui/material";

const certificateDateFormat = "MMM D, YYYY h A";

interface CertificateResponse {
	certificateDate: string;
}

const EscalationsEditor = ({
	monitor,
	refetch,
	monitorId,
}: {
	monitor: Monitor;
	refetch: Function;
	monitorId: string;
}) => {
	const { patch, loading: isPatching } = usePatch();
	const { data: notifications } = useGet<Notification[]>("/notifications/team");
	const [isEditing, setIsEditing] = useState(false);
	const [tempEscalations, setTempEscalations] = useState<
		{ minutes?: number; notificationId?: string }[]
	>([]);

	// keep local copy in sync when monitor changes
	useMemo(() => {
		setTempEscalations(monitor?.escalations ?? []);
	}, [monitor?.escalations]);

	const onEdit = () => {
		setTempEscalations((monitor?.escalations ?? []).map((e) => ({ ...e })));
		setIsEditing(true);
	};

	const onAdd = () => {
		setTempEscalations([
			...tempEscalations,
			{
				minutes: 5,
				notificationId:
					notifications && notifications.length > 0 ? notifications[0].id : "",
			},
		]);
	};

	const onRemove = (index: number) => {
		setTempEscalations(tempEscalations.filter((_, i) => i !== index));
	};

	const updateField = (
		index: number,
		key: keyof (typeof tempEscalations)[0],
		value: any
	) => {
		const copy = tempEscalations.map((e) => ({ ...e }));
		// @ts-ignore
		copy[index][key] = value;
		setTempEscalations(copy);
	};

	const onSave = async () => {
		try {
			const payload = { escalations: tempEscalations };
			const result = await patch(`/monitors/${monitorId}`, payload);
			if (result?.success) {
				setIsEditing(false);
				await refetch();
			}
		} catch (err) {
			console.error("Failed to save escalations", err);
		}
	};

	const onCancel = () => {
		setTempEscalations(monitor?.escalations ?? []);
		setIsEditing(false);
	};

	return (
		<Box
			sx={{
				mb: 3,
				p: 2,
				border: "1px solid",
				borderColor: "divider",
				borderRadius: 1,
				display: "flex",
				gap: 2,
			}}
		>
			<Box sx={{ width: 360, background: "#f6f6f6", p: 1, borderRadius: 1 }}>
				<Typography variant="h6">Escalations JSON</Typography>
				<pre style={{ maxHeight: "40vh", overflow: "auto" }}>
					{JSON.stringify(monitor?.escalations ?? [], null, 2)}
				</pre>
			</Box>
			<Box sx={{ flex: 1 }}>
				<Typography variant="h6">Escalations</Typography>
				{!isEditing ? (
					<>
						{(monitor?.escalations ?? []).length === 0 ? (
							<Typography>No escalations configured</Typography>
						) : (
							<ul>
								{(monitor?.escalations ?? []).map((e, i) => (
									<li key={i}>
										Minutes: {e.minutes ?? 0} — Notification: {e.notificationId ?? ""}
									</li>
								))}
							</ul>
						)}
						<Button onClick={onEdit}>Edit</Button>
					</>
				) : (
					<>
						{tempEscalations.map((e, i) => (
							<div
								key={i}
								style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
							>
								<TextField
									type="number"
									label="Minutes"
									value={e.minutes ?? 0}
									onChange={(ev) =>
										updateField(i, "minutes", Number(ev.target.value || 0))
									}
								/>
								<Select
									value={e.notificationId ?? ""}
									onChange={(ev) => updateField(i, "notificationId", ev.target.value)}
									displayEmpty
									sx={{ minWidth: 240 }}
								>
									<MenuItem value="">(choose notification)</MenuItem>
									{(notifications ?? []).map((n) => (
										<MenuItem
											key={n.id}
											value={n.id}
										>
											{n.notificationName} {n.type ? `(${n.type})` : ""}
										</MenuItem>
									))}
								</Select>
								<IconButton
									size="small"
									onClick={() => onRemove(i)}
									aria-label="Remove escalation"
								>
									<Trash2 size={16} />
								</IconButton>
							</div>
						))}
						<Box sx={{ mt: 1 }}>
							<Button
								variant="outlined"
								onClick={onAdd}
								disabled={false}
							>
								Add escalation
							</Button>
						</Box>
						<Box sx={{ mt: 2 }}>
							<Button
								onClick={onSave}
								loading={isPatching}
							>
								Save
							</Button>
							<Button
								onClick={onCancel}
								sx={{ ml: 1 }}
							>
								Cancel
							</Button>
						</Box>
					</>
				)}
			</Box>
		</Box>
	);
};

const UptimeDetailsPage = () => {
	const theme = useTheme();
	const isAdmin = useIsAdmin();
	const { monitorId } = useParams<{ monitorId: string }>();
	const uiTimezone = useSelector((state: RootState) => state.ui.timezone);

	const [page, setPage] = useState<number>(0);
	const [rowsPerPage, setRowsPerPage] = useState<number>(5);
	const [geoPage, setGeoPage] = useState<number>(0);
	const [geoRowsPerPage, setGeoRowsPerPage] = useState<number>(5);
	const [dateRange, setDateRange] = useState<string>("recent");
	const [selectedLocation, setSelectedLocation] = useState<GeoContinent>("NA");

	const monitorDetailsUrl = useMemo(() => {
		if (!monitorId) {
			return null;
		}
		const params = new URLSearchParams();
		params.append("dateRange", dateRange);
		params.append("normalize", "true");
		return `/monitors/uptime/details/${monitorId}?${params.toString()}`;
	}, [monitorId, dateRange]);

	const {
		data: monitorDetailsData,
		isLoading: monitorIsLoading,
		refetch: refetchMonitor,
	} = useGet<MonitorDetailsResponse>(
		monitorDetailsUrl,
		{},
		{ refreshInterval: 10000, keepPreviousData: true, revalidateOnFocus: false }
	);

	const monitorData = monitorDetailsData?.monitorData;
	const monitor = monitorData?.monitor;
	const monitorStats = monitorDetailsData?.monitorStats ?? null;

	// Certificate fetch - only for HTTP monitors
	const certificateUrl = useMemo(() => {
		if (!monitorId || monitor?.type !== "http") {
			return null;
		}
		return `/monitors/certificate/${monitorId}`;
	}, [monitorId, monitor?.type]);

	const { data: certificateData } = useGet<CertificateResponse>(
		certificateUrl,
		{},
		{ revalidateOnFocus: false }
	);

	const certificateExpiry = useMemo(() => {
		if (!certificateData?.certificateDate) {
			return undefined;
		}
		return (
			formatDateWithTz(
				certificateData.certificateDate,
				certificateDateFormat,
				uiTimezone
			) ?? "N/A"
		);
	}, [certificateData, uiTimezone]);

	const checksUrl = useMemo(() => {
		if (!monitorId || !monitor?.type) {
			return null;
		}
		const params = new URLSearchParams();
		params.append("type", monitor.type);
		params.append("sortOrder", "desc");
		params.append("dateRange", dateRange);
		params.append("page", String(page));
		params.append("rowsPerPage", String(rowsPerPage));
		return `/checks/${monitorId}?${params.toString()}`;
	}, [monitorId, monitor?.type, dateRange, page, rowsPerPage]);

	const { data: checksData, isLoading: checksIsLoading } = useGet<ChecksResponse>(
		checksUrl,
		{},
		{ keepPreviousData: true, revalidateOnFocus: false }
	);

	const geoChecksUrl = useMemo(() => {
		if (!monitorId || !supportsGeoCheck(monitor?.type) || !monitor?.geoCheckEnabled) {
			return null;
		}
		const params = new URLSearchParams();
		params.append("dateRange", dateRange);
		params.append("continent", selectedLocation);
		return `/monitors/${monitorId}/geo-checks?${params.toString()}`;
	}, [monitorId, monitor?.type, monitor?.geoCheckEnabled, dateRange, selectedLocation]);

	const { data: geoGroupedData } = useGet<GeoChecksResult>(
		geoChecksUrl,
		{},
		{ keepPreviousData: true, revalidateOnFocus: false }
	);

	const geoGroupedChecks = geoGroupedData?.groupedGeoChecks ?? [];

	// Fetch paginated geo checks for the table
	const geoChecksTableUrl = useMemo(() => {
		if (!monitorId || !supportsGeoCheck(monitor?.type) || !monitor?.geoCheckEnabled) {
			return null;
		}
		const params = new URLSearchParams();
		params.append("sortOrder", "desc");
		params.append("dateRange", dateRange);
		params.append("page", String(geoPage));
		params.append("rowsPerPage", String(geoRowsPerPage));
		return `/geo-checks/${monitorId}?${params.toString()}`;
	}, [
		monitorId,
		monitor?.type,
		monitor?.geoCheckEnabled,
		dateRange,
		geoPage,
		geoRowsPerPage,
	]);

	const { data: geoChecksTableData } = useGet<FlatGeoChecksResponse>(
		geoChecksTableUrl,
		{},
		{ keepPreviousData: true, revalidateOnFocus: false }
	);

	const geoChecksForTable = geoChecksTableData?.geoChecks ?? [];
	const geoChecksCount = geoChecksTableData?.geoChecksCount ?? 0;

	const geoLocations = monitor?.geoCheckLocations;

	const checks = checksData?.checks ?? [];
	const checksCount = checksData?.checksCount ?? 0;

	return (
		<BasePage>
			{/* Escalations editor - allow admins to edit escalations inline */}
			{isAdmin && monitor && (
				<EscalationsEditor
					monitor={monitor}
					refetch={refetchMonitor}
					monitorId={monitorId!}
				/>
			)}
			<HeaderMonitorControls
				path="uptime"
				monitor={monitor}
				isAdmin={isAdmin}
				refetch={refetchMonitor}
			/>
			<MonitorStatBoxes
				monitor={monitor}
				monitorStats={monitorStats}
				certificateExpiry={certificateExpiry}
			/>
			<HeaderTimeRange
				isLoading={monitorIsLoading || checksIsLoading}
				hasDateRange={true}
				dateRange={dateRange}
				setDateRange={setDateRange}
			/>

			<Stack
				direction={{ xs: "column", md: "row" }}
				gap={theme.spacing(8)}
			>
				<HistogramStatus
					title={t("common.charts.labels.uptime")}
					icon={<TrendingUp />}
					checks={monitorData?.groupedUpChecks ?? []}
					range={dateRange}
				/>
				<HistogramStatus
					title={t("common.charts.labels.downtime")}
					icon={<AlertTriangle />}
					checks={monitorData?.groupedDownChecks ?? []}
					range={dateRange}
				/>
				<RadialAvgResponse
					avg={monitorStats?.avgResponseTime || 0}
					max={500}
				/>
			</Stack>
			<HistogramDetails
				checks={monitorData?.groupedChecks || []}
				range={dateRange}
			/>
			<ChecksTable
				checks={checks}
				count={checksCount}
				page={page}
				setPage={setPage}
				rowsPerPage={rowsPerPage}
				setRowsPerPage={setRowsPerPage}
			/>

			{monitor?.geoCheckEnabled && (
				<>
					<Typography variant="h1">Location breakdown</Typography>
					<HeaderGeoTabs
						geoCheckEnabled={monitor?.geoCheckEnabled ?? false}
						locations={geoLocations}
						selectedLocation={selectedLocation}
						onLocationChange={setSelectedLocation}
					/>
					<HistogramDetails
						checks={geoGroupedChecks}
						range={dateRange}
					/>
					<GeoChecksTable
						geoChecks={geoChecksForTable}
						count={geoChecksCount}
						page={geoPage}
						setPage={setGeoPage}
						rowsPerPage={geoRowsPerPage}
						setRowsPerPage={setGeoRowsPerPage}
					/>
					<GeoChecksMap geoChecks={geoChecksForTable} />
				</>
			)}
		</BasePage>
	);
};

export default UptimeDetailsPage;
