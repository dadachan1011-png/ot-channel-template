# Memory Template

Copy this folder to `memory/` for a new deployment, then fill only the parts that belong to that team.

Do not commit the filled `memory/` folder. It may contain personal preferences, group context, ids, and business-private knowledge.

Recommended setup:

```powershell
Copy-Item -Recurse memory-template memory
```

Then fill:

- `prompts/global.md`
- `profiles/user.md`
- `kb/business.md`
- `kb/glossary.md`
- BI index files under `kb/bi/`
