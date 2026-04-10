from pathlib import Path
path = Path('client/src/Components/monitors/EscalationRulesDialog.tsx')
text = path.read_text(encoding='utf-8')
if '<DialogActions>' not in text:
    raise SystemExit('DialogActions not found')
if '</DialogContent>' in text:
    raise SystemExit('DialogContent already closed')
text = text.replace('<DialogActions>', '</DialogContent>\n\t<DialogActions>', 1)
path.write_text(text, encoding='utf-8')
print('patched')
