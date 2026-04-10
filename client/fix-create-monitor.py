from pathlib import Path
import re

path = Path('client/src/Pages/CreateMonitor/index.tsx')
text = path.read_text(encoding='utf-8')
pattern = re.compile(
    re.escape('{watchedUseAdvancedMatching && (')
    + r'[\s\S]*?'
    + re.escape('{supportsGeoCheck(watchedType) && ('),
    re.MULTILINE,
)
replacement = '''{watchedUseAdvancedMatching && (
                <Stack spacing={theme.spacing(LAYOUT.MD)}>
                    <Controller
                        name="matchMethod"
                        control={control}
                        render={({ field }) => (
                            <Select
                                {...field}
                                value={field.value ?? "equal"}
                                fieldLabel={t(
                                    "pages.createMonitor.form.advanced.option.matchMethod.label"
                                )}
                            >
                                <MenuItem value="equal">
                                    {t(
                                        "pages.createMonitor.form.advanced.option.matchMethod.equal"
                                    )}
                                </MenuItem>
                                <MenuItem value="include">
                                    {t(
                                        "pages.createMonitor.form.advanced.option.matchMethod.include"
                                    )}
                                </MenuItem>
                                <MenuItem value="regex">
                                    {t(
                                        "pages.createMonitor.form.advanced.option.matchMethod.regex"
                                    )}
                                </MenuItem>
                            </Select>
                        )}
                    />
                    <Controller
                        name="expectedValue"
                        control={control}
                        render={({ field, fieldState }) => (
                            <TextField
                                {...field}
                                value={field.value ?? ""}
                                fieldLabel={t(
                                    "pages.createMonitor.form.advanced.option.expectedValue.label"
                                )}
                                fullWidth
                                error={!!fieldState.error}
                                helperText={fieldState.error?.message ?? ""}
                            />
                        )}
                    />
                    <Controller
                        name="jsonPath"
                        control={control}
                        render={({ field, fieldState }) => (
                            <TextField
                                {...field}
                                value={field.value ?? ""}
                                fieldLabel={t(
                                    "pages.createMonitor.form.advanced.option.jsonPath.label"
                                )}
                                fullWidth
                                error={!!fieldState.error}
                                helperText={fieldState.error?.message ?? ""}
                            />
                        )}
                    />
                    <Typography
                        component="span"
                        color="text.secondary"
                        sx={{ opacity: 0.8 }}
                    >
                        <Trans
                            i18nKey="pages.createMonitor.form.advanced.option.jsonPath.description"
                            components={{
                                jmesLink: (
                                    <Link
                                        href="https://jmespath.org/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    />
                                ),
                            }}
                        />
                    </Typography>
                </Stack>
            )}

            {supportsGeoCheck(watchedType) && (
'''
new_text, count = pattern.subn(replacement, text, count=1)
if count == 0:
    raise SystemExit('pattern not found')
path.write_text(new_text, encoding='utf-8')
Path('client/fix-run.txt').write_text('patched', encoding='utf-8')
