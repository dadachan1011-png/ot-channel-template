# Lark / Feishu Bridge

This package connects Lark/Feishu messages to the local Channel Hub.

## Setup

1. Install dependencies from the repository root: `npm install`.
2. Copy `.env.example` to `.env`.
3. Fill Lark/Feishu credentials or CLI commands.
4. Start with `npm --prefix lark run dev`, or run the whole stack with `npm run service:start`.

## Configuration

Use `.env` or `CHANNEL_SHARED_ENV_PATH`.

Common values:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_ALLOWED_OPEN_ID`
- `LARK_READ_COMMAND` or `FEISHU_READ_COMMAND`
- `FEISHU_SHEET_READ_COMMAND`
- `HUB_URL`

## Notes

This bridge should stay generic. Put organization-specific Feishu document rules in `memory/kb/playbooks/feishu-suite.md` after copying `memory-template/` to a private `memory/` folder.
