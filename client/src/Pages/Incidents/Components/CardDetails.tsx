import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { BaseBox, ValueLabel } from "@/Components/design-elements";
import { LAYOUT } from "@/Utils/Theme/constants";

import { useTranslation } from "react-i18next";
import type { Incident, IncidentEscalation, EscalationEntry } from "@/Types/Incident";
import type { Monitor } from "@/Types/Monitor";
import { useTheme } from "@mui/material";
import { useSelector } from "react-redux";
import type { RootState } from "@/Types/state";
import { formatDateWithTz } from "@/Utils/TimeUtils";
import { getIncidentsDuration } from "@/Pages/Incidents/utils";
import { useGet } from "@/Hooks/UseApi";

interface CardDetailsProps {
	incident: Incident | null;
	monitor: Monitor | null;
	sx?: object;
}

export const CardDetails = ({ incident, monitor, sx }: CardDetailsProps) => {
	const { t } = useTranslation();
	const theme = useTheme();
	const uiTimezone = useSelector((state: RootState) => state.ui.timezone);
	const { data: escalation } = useGet<IncidentEscalation>(
		incident ? `/incidents/${incident.id}/escalations` : null
	);

	if (!incident) {
		return null;
	}
	return (
		<Stack
			gap={theme.spacing(LAYOUT.MD)}
			sx={sx}
		>
			<Typography textTransform={"uppercase"}>
				{t("pages.incidents.dialog.details.title")}
			</Typography>
			<BaseBox padding={LAYOUT.MD}>
				<Stack gap={theme.spacing(LAYOUT.MD)}>
					<Typography textTransform={"uppercase"}>
						{t("pages.incidents.dialog.details.overview")}
					</Typography>
					<Divider />

					<Grid
						container
						spacing={theme.spacing(LAYOUT.MD)}
						alignItems="center"
					>
						<Grid size={2}>{t("pages.incidents.dialog.details.status")}</Grid>
						<Grid size={10}>
							<ValueLabel
								value={incident.status ? "negative" : "positive"}
								text={
									incident.status
										? t("common.labels.active")
										: t("common.labels.resolved")
								}
							/>
						</Grid>
						{monitor && (
							<>
								<Grid size={2}>{t("pages.incidents.dialog.details.monitor")}</Grid>
								<Grid size={10}>
									<Typography>{monitor.name ?? "N/A"}</Typography>
								</Grid>
								<Grid size={2}>
									<Typography>{t("pages.incidents.dialog.details.url")}</Typography>
								</Grid>
								<Grid size={10}>
									<Typography>{monitor.url ?? "N/A"}</Typography>
								</Grid>
							</>
						)}
					</Grid>
				</Stack>
			</BaseBox>
			<BaseBox padding={LAYOUT.MD}>
				<Stack gap={theme.spacing(LAYOUT.MD)}>
					<Typography textTransform={"uppercase"}>
						{t("pages.incidents.dialog.details.analysis")}
					</Typography>
					<Divider />
					<Grid
						container
						spacing={theme.spacing(LAYOUT.MD)}
					>
						<Grid size={6}>
							<Typography>{t("pages.incidents.dialog.details.timeline")}</Typography>
						</Grid>
						<Grid size={6}>
							<Typography>{t("pages.incidents.dialog.details.detailsLabel")}</Typography>
						</Grid>
						<Grid size={6}>
							<Divider></Divider>
						</Grid>
						<Grid size={6}>
							<Divider></Divider>
						</Grid>
						<Grid size={2}>
							<Typography>{t("pages.incidents.dialog.details.startedAt")}</Typography>
						</Grid>
						<Grid size={4}>
							<Typography>
								{formatDateWithTz(incident.startTime, "D MMM YYYY, h:mm A", uiTimezone)}
							</Typography>
						</Grid>
						<Grid size={2}>
							<Typography>{t("pages.incidents.dialog.details.statusCode")}</Typography>
						</Grid>
						<Grid size={4}>
							<Typography>{incident.statusCode ?? "N/A"}</Typography>
						</Grid>
						<Grid size={2}>
							<Typography>{t("pages.incidents.dialog.details.downtime")}</Typography>
						</Grid>
						<Grid size={4}>
							<Typography>{getIncidentsDuration(incident)}</Typography>
						</Grid>
						<Grid size={2}>
							<Typography>{t("pages.incidents.dialog.details.message")}</Typography>
						</Grid>
						<Grid size={4}>
							<Typography>{incident.message ?? "N/A"}</Typography>
						</Grid>
					</Grid>
				</Stack>
			</BaseBox>
			{!incident.status && (
				<BaseBox padding={LAYOUT.MD}>
					<Stack gap={theme.spacing(LAYOUT.XS)}>
						<Typography textTransform={"uppercase"}>
							{t("pages.incidents.dialog.details.resolutionDetails")}
						</Typography>
						<Divider />
						<Grid
							container
							spacing={theme.spacing(LAYOUT.MD)}
							alignItems="center"
						>
							<Grid size={2}>
								<Typography>{t("pages.incidents.dialog.details.resolvedAt")}</Typography>
							</Grid>
							<Grid size={10}>
								<Typography>
									{incident.endTime
										? formatDateWithTz(incident.endTime, "D MMM YYYY, h:mm A", uiTimezone)
										: "N/A"}
								</Typography>
							</Grid>
							<Grid size={2}>
								<Typography>
									{t("pages.incidents.dialog.details.resolutionType")}
								</Typography>
							</Grid>
							<Grid size={10}>
								<Typography>
									{incident.resolutionType
										? t(
												`pages.incidents.dialog.details.resolutionTypes.${incident.resolutionType}`
											)
										: "N/A"}
								</Typography>
							</Grid>
							{incident.resolvedBy && (
								<>
									<Grid size={2}>
										<Typography>
											{t("pages.incidents.dialog.details.resolvedBy")}
										</Typography>
									</Grid>
									<Grid size={10}>
										<Typography>
											{incident.resolvedByEmail ?? incident.resolvedBy}
										</Typography>
									</Grid>
								</>
							)}
							{incident.comment && (
								<>
									<Grid size={2}>
										<Typography>{t("pages.incidents.dialog.details.comment")}</Typography>
									</Grid>
									<Grid size={10}>
										<Typography>{incident.comment}</Typography>
									</Grid>
								</>
							)}
						</Grid>
					</Stack>
				</BaseBox>
			)}
			{incident.status && escalation && (
				<BaseBox padding={LAYOUT.MD}>
					<Stack gap={theme.spacing(LAYOUT.MD)}>
						<Typography textTransform={"uppercase"}>
							{t("pages.incidents.dialog.details.escalation.title")}
						</Typography>
						<Divider />
						<Grid
							container
							spacing={theme.spacing(LAYOUT.MD)}
						>
							<Grid size={6}>
								<Typography>
									{t("pages.incidents.dialog.details.escalation.interval")}
								</Typography>
							</Grid>
							<Grid size={6}>
								<Typography>
									{escalation.intervalMinutes}{" "}
									{t("pages.incidents.dialog.details.escalation.minutes")}
								</Typography>
							</Grid>
							{escalation.scheduledNextNotification && (
								<>
									<Grid size={6}>
										<Typography>
											{t("pages.incidents.dialog.details.escalation.nextNotification")}
										</Typography>
									</Grid>
									<Grid size={6}>
										<Typography>
											{formatDateWithTz(
												escalation.scheduledNextNotification,
												"D MMM YYYY, h:mm A",
												uiTimezone
											)}
										</Typography>
									</Grid>
								</>
							)}
							{escalation.escalationHistory &&
								escalation.escalationHistory.length > 0 && (
									<>
										<Grid size={12}>
											<Typography sx={{ mt: theme.spacing(1) }}>
												{t("pages.incidents.dialog.details.escalation.history")}
											</Typography>
										</Grid>
										<Grid size={12}>
											<Stack gap={theme.spacing(LAYOUT.SM)}>
												{escalation.escalationHistory.map(
													(entry: EscalationEntry, index: number) => (
														<Stack
															key={index}
															direction="row"
															justifyContent="space-between"
														>
															<Typography variant="body2">{`#${index + 1}`}</Typography>
															<Typography variant="body2">
																{formatDateWithTz(
																	entry.notificationSentAt,
																	"D MMM YYYY, h:mm A",
																	uiTimezone
																)}
															</Typography>
														</Stack>
													)
												)}
											</Stack>
										</Grid>
									</>
								)}
						</Grid>
					</Stack>
				</BaseBox>
			)}
		</Stack>
	);
};
