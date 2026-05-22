# Channel Hub

Channel Hub is the shared routing layer for personal agent communication across Lark, DingTalk, and future channels.

The goal is to keep task state, confirmations, notification policy, and user context outside any single channel adapter. Lark and DingTalk should be interchangeable delivery surfaces, not separate task systems.

## Current Direction

- DingTalk is the high-frequency action channel for urgent alerts, confirmations, failures, and mobile task control.
- Lark is the lower-frequency project context channel for summaries, implementation status, automation reports, fallback, and searchable history.
- Critical items can fan out to both.
- Internal tasks and confirmations should be referenced by human-readable names and short visible numbers; stable IDs stay internal.

## Current Implementation

The first runnable Hub core is implemented in TypeScript.

Implemented:

- Shared natural-language parser for DingTalk and Lark.
- Natural conversation layer: semantic fast path, Codex-backed intent interpreter, and deterministic fallback.
- Shared task state, confirmation queue, envelopes, incoming messages, and delivery attempts.
- Confirmed routing matrix: P0 both, P1 DingTalk, P2 Lark, P3 local only.
- Cross-channel confirmation resolution.
- OpenClaw-style channel lifecycle: session keys, short-message debounce, ACK/typing status, channel capabilities, and text fallback actions.
- Ambiguity handling for bare replies like `同意`.
- Unknown-message help that explains how to communicate.
- Conversation close summaries with automatic routing.
- Local HTTP API.
- HTTP notify adapters that forward routed output to the existing DingTalk and Lark bridge `/notify` endpoints.
- Existing DingTalk/Lark bridges can forward incoming messages to Hub when `HUB_URL` is configured.

Not implemented yet:

- The store is currently JSON for the first runnable version; SQLite migration is still pending.
- Action buttons are not implemented; text commands are the canonical MVP interface.

## Run

```powershell
npm install
npm run dev
```

Default local API:

```text
http://127.0.0.1:4770
```

Default downstream notification endpoints:

```dotenv
HUB_DINGTALK_NOTIFY_URL=http://127.0.0.1:4767/notify
HUB_LARK_NOTIFY_URL=http://127.0.0.1:4766/notify
```

Intelligent conversation uses the local Codex CLI. It does not require an external API key.

```dotenv
CODEX_CLI_PATH=node
CODEX_CLI_ARGS_PREFIX=../node_modules/@openai/codex/bin/codex.js
HUB_INTENT_MODEL=gpt-5.5
HUB_INTENT_REASONING_EFFORT=medium
HUB_INTENT_TIMEOUT_MS=60000
HUB_INCOMING_DEBOUNCE_MS=1200
```

Channel Hub first handles common natural speech locally, then asks Codex to interpret harder free-form messages against current tasks and pending confirmations. Explicit commands still use the deterministic fast path. If Codex is busy or unavailable, Hub falls back to the local parser and explains how to communicate.

Enable Hub mode in both existing bridges:

```dotenv
HUB_URL=http://127.0.0.1:4770
ACK_ENABLED=true
ACK_EMOJI=👀
```

With `HUB_URL` set, DingTalk and Lark bridge inbound messages are forwarded to Channel Hub first. With `ACK_ENABLED=true`, the bridge immediately replies `👀` to authorized private messages before forwarding them, so the user can see the channel is online while Hub/Codex is still processing. If Hub is unavailable, the bridge falls back to its previous local handler.

Key endpoints:

```text
POST /envelopes
POST /incoming/:channel
POST /tasks
POST /confirmations
POST /conversation-summaries
GET /status
GET /channels/status
GET /confirmations/pending
GET /state
```

Example:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:4770/confirmations `
  -ContentType application/json `
  -Body '{"title":"是否允许修改项目配置","body":"影响：会改项目配�?,"requestedBy":"automation"}'
```

## Verify

```powershell
npm test
npm run build
```

## Documents

- [Routing Strategy](docs/routing-strategy.md)
- [Global Communication Rules](docs/communication-rules.md)
- [Routing Policy Example](docs/routing-policy.example.yaml)
