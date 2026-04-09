const fs = require('fs');

const path = '../client/src/Pages/CreateMonitor/index.tsx';
let text = fs.readFileSync(path, 'utf8');

const idx = text.indexOf('pages.createMonitor.form.notifications.title');
const target = '/>\r\n\t\t\t\t}\r\n\t\t\t/>';
let idx2 = text.indexOf(target, idx);
if (idx2 === -1) {
    const targetLf = '/>\n\t\t\t\t}\n\t\t\t/>';
    idx2 = text.indexOf(targetLf, idx);
    if (idx2 === -1) {
        console.error('Target not found');
        process.exit(1);
    }
}

const replacement = text.substring(idx2, idx2 + target.length) + `

			<ConfigBox
				title="Escalation Rules"
				subtitle="Configure actions if a monitor remains down continuously."
				rightContent={
					<Stack spacing={theme.spacing(LAYOUT.MD)}>
						<Controller
							name="escalationTime"
							control={control}
							render={({ field, fieldState }) => (
								<TextField
									{...field}
									type="number"
									value={field.value ?? ""}
									onChange={(e) => {
										const val = e.target.value;
										field.onChange((val === "" || val === null) ? null : Number(val));
									}}
									error={!!fieldState.error}
									helperText={fieldState.error?.message}
									fieldLabel="Escalate after (minutes)"
									placeholder="e.g. 15"
									fullWidth
								/>
							)}
						/>
						<Controller
							name="escalationChannels"
							control={control}
							render={({ field }) => {
								const notificationOptions = (notifications ?? []).map((n) => ({
									...n,
									name: n.notificationName,
								}));

								const fieldValArray: string[] = Array.isArray(field.value) ? field.value : [];
								const selectedNotifications = notificationOptions.filter((n) =>
									fieldValArray.includes(n.id)
								);

								return (
									<Stack spacing={theme.spacing(LAYOUT.MD)}>
										<Autocomplete
											multiple
											options={notificationOptions}
											value={selectedNotifications}
											getOptionLabel={(option) => option.name}
											onChange={(_: unknown, newValue: typeof notificationOptions) => {
												field.onChange(newValue.map((n) => n.id));
											}}
											isOptionEqualToValue={(option, value) => option.id === value.id}
											fieldLabel="Escalation notification channels"
											placeholder={fieldValArray.length > 0 ? "" : "Select some channels"}
										/>
										{selectedNotifications.length > 0 && (
											<Stack flex={1} width="100%">
												{selectedNotifications.map((notification, index) => (
													<Stack
														direction="row"
														alignItems="center"
														key={notification.id}
														width="100%"
													>
														<Typography flexGrow={1}>
															{notification.notificationName}
														</Typography>
														<IconButton
															size="small"
															onClick={() => {
																field.onChange(
																	fieldValArray.filter((id) => id !== notification.id)
																);
															}}
															aria-label="Remove notification"
														>
															<Trash2 size={16} />
														</IconButton>
														{index < selectedNotifications.length - 1 && <Divider />}
													</Stack>
												))}
											</Stack>
										)}
									</Stack>
								);
							}}
						/>
					</Stack>
				}
			/>`;

text = text.substring(0, idx2) + replacement + text.substring(idx2 + target.length || target.length);

// Needs to add Trash2 and Typography to imports if not there. Let's assume Typography and Stack are there. 
// For Trash2:
if (!text.includes('Trash2')) {
    text = text.replace('import {', 'import { Trash2, ');
}
if (!text.includes('Divider')) {
    text = text.replace('import {', 'import { Divider, ');
}


fs.writeFileSync(path, text, 'utf8');
console.log('Update complete.');
