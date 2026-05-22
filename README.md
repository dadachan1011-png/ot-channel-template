# OT Channel Template

A reusable local-agent channel framework for DingTalk, Feishu/Lark, Codex CLI, fast tools, BI lookup, and layered memory.

This repository is a template. It intentionally does not include personal persona, private chat history, real DingTalk IDs, real secrets, or company BI snapshots.

## What This Includes

- `hub/`: central router, intent interpreter, task dispatcher, memory provider, fast tools, Codex CLI bridge, tests.
- `dingtalk/`: DingTalk enterprise app robot bridge using Stream mode.
- `lark/`: Lark/Feishu bridge.
- `memory-template/`: safe template for global, user, group, session, pending, and knowledge-base memory.
- `docs/`: routing, BI skill, memory model, privacy, and GitHub publishing notes.
- `scripts/`: local start/stop/watch scripts.

## What This Can Do

- Receive DingTalk/Lark messages and forward them into a local Hub.
- Route messages into chat, fast lookup, planned task, direct action, or hard commands.
- Use OpenAI-compatible LLM gateways for chat, intent interpretation, document analysis, and BI reasoning.
- Invoke Codex CLI as the slower but stronger planning/execution fallback.
- Use configured fast tools for mature workflows such as BI field/source lookup and Feishu document reading.
- Maintain layered memory: global prompts, user profile, group profile, short session context, pending candidates, and knowledge-base playbooks.

## Quick Start

```powershell
npm install
Copy-Item .env.example .env
npm test
npm run build
npm run service:start
```

Fill `.env` before starting the bridges. The minimum useful setup is:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `DINGTALK_CLIENT_ID`
- `DINGTALK_CLIENT_SECRET`
- `DINGTALK_ROBOT_CODE`
- `DINGTALK_ALLOWED_SENDER_STAFF_ID`
- `DINGTALK_NOTIFY_USER_ID`
- `ALLOWED_WORKSPACE_ROOT`

## Personalization

Do not hardcode one person or one team's style in source code. Put deploy-specific content in:

- `.env`: credentials, ids, local paths, model settings.
- `memory/prompts/global.md`: assistant persona and response style.
- `memory/profiles/user.md`: owner preferences.
- `memory/profiles/groups/<group>.md`: group-specific facts.
- `memory/kb/`: organization-specific BI metadata and playbooks.

Use `memory-template/` as the starting structure.

## Verification

```powershell
npm test
npm run build
powershell -ExecutionPolicy Bypass -File scripts/check-sanitized.ps1
```

Run the sanitizer before publishing or opening a pull request.
