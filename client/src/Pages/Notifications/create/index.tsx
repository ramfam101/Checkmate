import { BasePage, ConfigBox } from "@/Components/design-elements";
import { TextField, Select, Button } from "@/Components/inputs";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useGet, usePost, usePatch } from "@/Hooks/UseApi";
import { useNotificationForm } from "@/Hooks/useNotificationForm";
import type { NotificationFormData } from "@/Validation/notifications";
import type { Notification } from "@/Types/Notification";
import { useTranslation } from "react-i18next";
import { NotificationChannels } from "@/Types/Notification";

const NotificationsCreatePage = () => {
	const { t } = useTranslation();
	const theme = useTheme();
	const navigate = useNavigate();
	const { notificationId } = useParams<{ notificationId: string }>();
	const isEditMode = Boolean(notificationId);

	const { data: existingNotification } = useGet<Notification>(
		isEditMode ? `/notifications/${notificationId}` : null
	);

	const { post, loading: isSubmitting } = usePost<NotificationFormData, Notification>();
	const { patch, loading: isPatching } = usePatch<NotificationFormData, Notification>();
	const { post: testPost, loading: isTesting } = usePost<NotificationFormData, void>();

	const { schema, defaults } = useNotificationForm({ data: existingNotification });

	const form = useForm<NotificationFormData>({
		resolver: zodResolver(schema),
		defaultValues: defaults,
	});

	const { control, watch, reset, handleSubmit, clearErrors, trigger, getValues } = form;

	const { data: teamNotifications } = useGet<Notification[]>("/notifications/team");

	const [localRules, setLocalRules] = useState<NonNullable<Notification["escalationRules"]>>(
		defaults.escalationRules || []
	);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const backupRef = useRef<NonNullable<Notification["escalationRules"]> | null>(null);

	useEffect(() => {
		reset(defaults);
		setLocalRules(defaults.escalationRules || []);
	}, [defaults, reset]);

	const watchedType = watch("type");

	useEffect(() => {
		clearErrors();
	}, [watchedType, clearErrors]);

	const addressConfig = useMemo(() => {
		if (watchedType === "pager_duty") {
			return {
				title: t("pages.notifications.form.pagerDuty.title"),
				description: t("pages.notifications.form.pagerDuty.description"),
				fieldLabel: t("pages.notifications.form.pagerDuty.optionIntegrationKey"),
				placeholder: t("pages.notifications.form.pagerDuty.placeholder"),
			};
		}
		if (watchedType === "email") {
			return {
				title: t("pages.notifications.form.address.title"),
				description: t("pages.notifications.form.address.description"),
				fieldLabel: t("pages.notifications.form.address.optionAddress"),
				placeholder: t("pages.notifications.form.address.placeholderEmail"),
			};
		}
		return {
			title: t("pages.notifications.form.address.title"),
			description: t("pages.notifications.form.address.description"),
			fieldLabel: t("pages.notifications.form.address.optionAddress"),
			placeholder: t("pages.notifications.form.address.placeholderWebhook"),
		};
	}, [watchedType, t]);

	const onSubmit = async (data: NotificationFormData) => {
		// merge escalation rules into payload
		const payload = {
			...data,
			escalationRules: localRules?.map((r) => ({
				id: r.id,
				afterMinutes: Number(r.afterMinutes),
				notificationId: r.notificationId,
			})),
		};

		const result = isEditMode
			? await patch(`/notifications/${notificationId}`, payload)
			: await post("/notifications", payload);
		if (result) {
			navigate("/notifications");
		}
	};

	const handleTest = async () => {
		const isValid = await trigger();
		if (!isValid) return;
		const data = getValues();
		await testPost("/notifications/test", data);
	};

	const startEdit = (idx: number) => {
		backupRef.current = [...localRules];
		setEditingIndex(idx);
	};

	const addRule = () => {
		setLocalRules((prev) => {
			const next = [...prev, { id: undefined, afterMinutes: 5, notificationId: undefined }];
			backupRef.current = [...prev];
			setEditingIndex(prev.length);
			return next;
		});
	};

	const updateRuleField = (idx: number, field: keyof NonNullable<Notification["escalationRules"]>[0], value: any) => {
		setLocalRules((prev) =>
			prev.map((rule, i) => (i === idx ? { ...rule, [field]: value } : rule))
		);
	};

	const saveRule = (idx: number) => {
		// basic validation: afterMinutes must be >=1
		const rule = localRules[idx];
		if (!rule || Number(rule.afterMinutes) < 1) return;
		setEditingIndex(null);
		backupRef.current = null;
	};

	const cancelEdit = () => {
		if (backupRef.current) {
			setLocalRules(backupRef.current);
		}
		setEditingIndex(null);
		backupRef.current = null;
	};

	const deleteRule = (idx: number) => {
		setLocalRules((prev) => prev.filter((_, i) => i !== idx));
		if (editingIndex === idx) {
			setEditingIndex(null);
			backupRef.current = null;
		}
	};

	return (
		<BasePage
			component="form"
			onSubmit={handleSubmit(onSubmit)}
		>
			<ConfigBox
				title={t("pages.notifications.form.notificationName.title")}
				subtitle={t("pages.notifications.form.notificationName.description")}
				rightContent={
					<Controller
						name="notificationName"
						control={control}
						defaultValue={defaults.notificationName}
						render={({ field, fieldState }) => (
							<TextField
								{...field}
								type="text"
								fieldLabel={t("pages.notifications.form.notificationName.optionName")}
								placeholder={t("pages.notifications.form.notificationName.placeholder")}
								fullWidth
								error={!!fieldState.error}
								helperText={fieldState.error?.message ?? ""}
							/>
						)}
					/>
				}
			/>
			<ConfigBox
				title={t("pages.notifications.form.type.title")}
				subtitle={t("pages.notifications.form.type.description")}
				rightContent={
					<Controller
						name="type"
						control={control}
						defaultValue={defaults.type}
						render={({ field, fieldState }) => (
							<Select
								value={field.value}
								fieldLabel={t("pages.notifications.form.type.optionType")}
								error={!!fieldState.error}
								onChange={field.onChange}
							>
								{NotificationChannels.map((type: string) => (
									<MenuItem
										key={type}
										value={type}
									>
										<Typography textTransform="capitalize">{type}</Typography>
									</MenuItem>
								))}
							</Select>
						)}
					/>
				}
			/>
			{watchedType !== "matrix" && (
				<ConfigBox
					title={addressConfig.title}
					subtitle={addressConfig.description}
					rightContent={
						<Controller
							name="address"
							control={control}
							defaultValue={defaults.address}
							render={({ field, fieldState }) => (
								<TextField
									{...field}
									type="text"
									fieldLabel={addressConfig.fieldLabel}
									placeholder={addressConfig.placeholder}
									fullWidth
									error={!!fieldState.error}
									helperText={fieldState.error?.message ?? ""}
								/>
							)}
						/>
					}
				/>
			)}
				<ConfigBox
					title={t("pages.notifications.form.escalation.title")}
					subtitle={t("pages.notifications.form.escalation.description")}
					rightContent={
						<Stack spacing={theme.spacing(4)}>
							{(localRules || []).map((rule, idx) => (
								<Stack key={rule.id ?? idx} direction="row" spacing={2} alignItems="center">
									{editingIndex === idx ? (
										<>
											<TextField
												type="number"
												value={String(rule.afterMinutes)}
												fieldLabel={t("pages.notifications.form.escalation.afterMinutes")}
												onChange={(e: any) => updateRuleField(idx, "afterMinutes", Number(e.target.value))}
												error={Number(rule.afterMinutes) < 1}
												helperText={Number(rule.afterMinutes) < 1 ? t("pages.notifications.form.escalation.afterMinutesError") : ""}
												style={{ width: 120 }}
											/>
											<Select
												value={rule.notificationId || ""}
												fieldLabel={t("pages.notifications.form.escalation.target")}
												onChange={(e: any) => updateRuleField(idx, "notificationId", e.target.value)}
												style={{ minWidth: 220 }}
											>
												<MenuItem value="">{t("pages.notifications.form.escalation.thisChannel")}</MenuItem>
												{(teamNotifications || [])
													.filter((n) => n.id !== notificationId)
													.map((n) => (
														<MenuItem key={n.id} value={n.id}>{n.notificationName}</MenuItem>
													))}
											</Select>
											<Button size="small" variant="contained" color="primary" onClick={() => saveRule(idx)}>
												{t("common.buttons.save")}
											</Button>
											<Button size="small" variant="outlined" color="secondary" onClick={cancelEdit}>
												{t("common.buttons.cancel")}
											</Button>
											<Button size="small" variant="outlined" color="error" onClick={() => deleteRule(idx)}>
												{t("common.buttons.delete")}
											</Button>
										</>
									) : (
										<>
											<Typography flexGrow={1}>
												{t("pages.notifications.form.escalation.after")}: {rule.afterMinutes} {t("common.words.minutes")} → {rule.notificationId ? (teamNotifications || []).find((n) => n.id === rule.notificationId)?.notificationName : t("pages.notifications.form.escalation.thisChannel")}
											</Typography>
											<Button size="small" variant="outlined" onClick={() => startEdit(idx)}>
												{t("common.buttons.edit")}
											</Button>
											<Button size="small" variant="outlined" color="error" onClick={() => deleteRule(idx)}>
												{t("common.buttons.delete")}
											</Button>
										</>
									)}
								</Stack>
							))}
							<Button size="small" variant="contained" onClick={addRule}>
								{t("pages.notifications.form.escalation.addRule")}
							</Button>
						</Stack>
					}
				/>
			{watchedType === "matrix" && (
				<ConfigBox
					title={t("pages.notifications.form.matrix.title")}
					subtitle={t("pages.notifications.form.matrix.description")}
					rightContent={
						<Stack spacing={theme.spacing(8)}>
							<Controller
								name="homeserverUrl"
								control={control}
								defaultValue={defaults.homeserverUrl}
								render={({ field, fieldState }) => (
									<TextField
										{...field}
										type="text"
										fieldLabel={t("pages.notifications.form.homeServer.optionHomeServer")}
										placeholder={t("pages.notifications.form.homeServer.placeholder")}
										fullWidth
										error={!!fieldState.error}
										helperText={fieldState.error?.message ?? ""}
									/>
								)}
							/>
							<Controller
								name="roomId"
								control={control}
								defaultValue={defaults.roomId}
								render={({ field, fieldState }) => (
									<TextField
										{...field}
										type="text"
										fieldLabel={t("pages.notifications.form.roomId.optionRoomId")}
										placeholder={t("pages.notifications.form.roomId.placeholder")}
										fullWidth
										error={!!fieldState.error}
										helperText={fieldState.error?.message ?? ""}
									/>
								)}
							/>
							<Controller
								name="accessToken"
								control={control}
								defaultValue={defaults.accessToken}
								render={({ field, fieldState }) => (
									<TextField
										{...field}
										type="text"
										fieldLabel={t(
											"pages.notifications.form.accessToken.optionAccessToken"
										)}
										placeholder={t("pages.notifications.form.accessToken.placeholder")}
										fullWidth
										error={!!fieldState.error}
										helperText={fieldState.error?.message ?? ""}
									/>
								)}
							/>
						</Stack>
					}
				/>
			)}
			<Stack
				direction="row"
				justifyContent="flex-end"
				spacing={theme.spacing(2)}
			>
				<Button
					variant="contained"
					color="primary"
					onClick={handleTest}
					loading={isTesting}
				>
					{t("common.buttons.test")}
				</Button>
				<Button
					loading={isSubmitting || isPatching}
					type="submit"
					variant="contained"
					color="primary"
				>
					{t("common.buttons.save")}
				</Button>
			</Stack>
		</BasePage>
	);
};

export default NotificationsCreatePage;
