# Privacy And Sanitization

Before sharing this template, verify that these are not included:

- real `.env` files
- DingTalk user ids, staff ids, conversation ids, session keys
- OpenAI or gateway tokens
- live `memory/` contents
- group chat logs
- personal persona or owner habits
- company-private BI exports and snapshots
- `.local/`, `dist/`, `node_modules/`, logs

Use placeholders in `.env.example` and templates.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-sanitized.ps1
```

If the sanitizer flags a term, either remove it or move it into a private deployment memory file.
