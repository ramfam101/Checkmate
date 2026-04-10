#!/usr/bin/env python3
from pathlib import Path

file_path = Path(r'c:\Users\SeaDo\VSCode Projects\Checkmate\client\src\Components\monitors\EscalationRulesDialog.tsx')
lines = file_path.read_text().split('\n')

# Find and fix the broken section starting around line 277
new_lines = []
i = 0
while i < len(lines):
    if i >= 275 and i <= 302:  # Around the broken section
        if '{escalationChannelOptions.map((notification) => (' in lines[i]:
            # Keep lines until </Select>
            while i < len(lines) and '</Select>' not in lines[i]:
                new_lines.append(lines[i])
                i += 1
            if i < len(lines):
                new_lines.append(lines[i])  # Add </Select>
                i += 1
            # Skip broken lines and add corrected ones
            new_lines.append('')  # blank line
            new_lines.append('\t\t\t\t{escalationChannelOptions.length === 0 ? (')
            new_lines.append('\t\t\t\t\t<Alert severity="info" sx={{ mb: 2 }}>')
            new_lines.append('\t\t\t\t\t\t{t(')
            new_lines.append('\t\t\t\t\t\t\t"pages.monitor.escalations.noEscalationChannels",')
            new_lines.append('\t\t\t\t\t\t\t"Add another notification channel before saving an escalation rule."')
            new_lines.append('\t\t\t\t\t\t)}')
            new_lines.append('\t\t\t\t\t</Alert>')
            new_lines.append('\t\t\t\t) : null}')
            # Skip old broken lines
            while i < len(lines) and 'noEscalationChannels' not in lines[i]:
                i += 1
            # Skip past the old broken block
            skip_until_box = True
            while i < len(lines) and skip_until_box:
                if '<Box sx={{ display: "flex"' in lines[i]:
                    skip_until_box = False
                i += 1
            i -= 1  # Back up one since we went one too far
        if i < len(lines):
            new_lines.append(lines[i])
            i += 1
    else:
        new_lines.append(lines[i])
        i += 1

result = '\n'.join(new_lines)
file_path.write_text(result)
print("✓ File patched via line-by-line method")
