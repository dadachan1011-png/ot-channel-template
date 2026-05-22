# DingTalk Bridge

This package connects a DingTalk enterprise app robot to the local Channel Hub through DingTalk Stream mode.

## Setup

1. Install dependencies from the repository root: `npm install`
2. Copy `.env.example` to `.env` and fill DingTalk credentials.
3. Enable Stream mode for the DingTalk enterprise app robot.
4. Start the bridge with `npm --prefix dingtalk run dev`, or start the whole stack with `npm run service:start`.

Stream mode keeps a long connection to DingTalk, so it does not require a public callback URL or ngrok-style tunnel.

## Required DingTalk Values

- `DINGTALK_CLIENT_ID`: app key / client id from the DingTalk developer console.
- `DINGTALK_CLIENT_SECRET`: app secret / client secret.
- `DINGTALK_ROBOT_CODE`: robot code from the app robot configuration. If omitted, the bridge falls back to `DINGTALK_CLIENT_ID`.
- `DINGTALK_ALLOWED_SENDER_STAFF_ID`: user id allowed to trigger privileged local execution.
- `DINGTALK_NOTIFY_USER_ID`: user id that receives private notifications.

## Commands

- `/ping`
- `/codex <task>`
- `/status`
- `/cancel <task_id>`
- `/confirm <confirm_id> yes|no`
- `/reply <confirm_id> <text>`

Natural language messages are forwarded to Hub when `HUB_URL` is configured. The Hub decides whether to chat, run fast tools, plan a task, or invoke Codex CLI.

## Safety

- Privileged execution is limited by `DINGTALK_ALLOWED_SENDER_STAFF_ID`.
- Local execution cwd is restricted by `ALLOWED_WORKSPACE_ROOT`.
- Runtime state lives under `.local/` and must not be committed.
