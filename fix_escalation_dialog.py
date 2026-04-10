#!/usr/bin/env python3
from pathlib import Path

file_path = Path(r'c:\Users\SeaDo\VSCode Projects\Checkmate\client\src\Components\monitors\EscalationRulesDialog.tsx')
content = file_path.read_text()

# Replace the broken JSX section
old_section = '''{escalationChannelOptions.map((notification) => (
						<MenuItem key={notification.id} value={notification.id}>
							{notification.notificationName}
						</MenuItem>
					))}
				</Select>
						{t(
							"pages.monitor.escalations.noEscalationChannels",
							"Select a different source notification or add another notification channel before saving an escalation rule."
						)}
					</Alert>
				) : null}

				<Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
					<Button
				variant="outlined"
				onClick={() => {
					resetNewRule();
					setShowAddForm(false);
				}}>
						{t("common.cancel", "Cancel")}
					</Button>'''

new_section = '''{escalationChannelOptions.map((notification) => (
						<MenuItem key={notification.id} value={notification.id}>
							{notification.notificationName}
						</MenuItem>
					))}
				</Select>

				{escalationChannelOptions.length === 0 ? (
					<Alert severity="info" sx={{ mb: 2 }}>
						{t(
							"pages.monitor.escalations.noEscalationChannels",
							"Add another notification channel before saving an escalation rule."
						)}
					</Alert>
				) : null}

				<Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
					<Button
						variant="outlined"
						onClick={() => {
							resetNewRule();
							setShowAddForm(false);
						}}
					>
						{t("common.cancel", "Cancel")}
					</Button>'''

if old_section in content:
    content = content.replace(old_section, new_section)
    file_path.write_text(content)
    print("✓ File fixed successfully!")
else:
    print("✗ Could not find the target section to replace")
    print("\nSearching for similar patterns...")
    if "{escalationChannelOptions.map" in content:
        print("  Found: escalationChannelOptions mapping")
    if 'noEscalationChannels' in content:
        print("  Found: noEscalationChannels reference")
    if 'displayEmpty' in content:
        print("  Found: Select component")
