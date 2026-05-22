# GitHub Publishing Checklist

1. Run `npm test`.
2. Run `npm run build`.
3. Run `scripts/check-sanitized.ps1`.
4. Confirm `.env` is not tracked.
5. Confirm `memory/` is not tracked.
6. Confirm `node_modules/`, `dist/`, `.local/`, and logs are not tracked.
7. Confirm README explains that each team must fill its own persona, credentials, BI index, and memory.
8. Create the GitHub repository.
9. Commit only the template files.
10. Push and share with the team.
