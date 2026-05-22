# Channel Routing Strategy

## Goal

Build one shared notification and task-routing core for all personal communication channels, starting with Lark and DingTalk.

The core principle: tasks, confirmations, automation results, and user context belong to Channel Hub. Lark and DingTalk are channel adapters.

## Channel Roles

| Channel | Role | Usage |
|---|---|---|
| DingTalk | Primary high-frequency channel | Mobile-first alerts, confirmations, urgent task control |
| Lark | Secondary project channel | Project communication, lower-frequency summaries, fallback |
| Local store | Source of truth | Task state, notification history, confirmation queue, routing decisions |

This route split is confirmed for the first global version:

- DingTalk is the default P1 action channel.
- Lark is the default P2 project/context channel.
- P0 always fans out to both DingTalk and Lark.
- P3 never pushes to chat unless the user explicitly asks for details.
- The channel where a task starts receives normal progress, but priority escalation can override that continuity.

## Notification Priority

| Priority | Meaning | Examples | Default Route |
|---|---|---|---|
| P0 | Immediate interruption | Security/account decision, destructive action, blocked task | DingTalk + Lark |
| P1 | High-value daily signal | Task failed, task completed, confirmation required, automation abnormal | DingTalk |
| P2 | Useful but not urgent | Daily reports, project scans, low-risk suggestions | Lark or DingTalk digest |
| P3 | Archive only | Verbose logs, detailed command output, routine success | Local store |

## Message Types

Every incoming or outgoing item should be normalized into a routing envelope:

```ts
type ChannelEnvelope = {
  id: string;
  type: "task" | "confirmation" | "automation_result" | "report" | "error" | "chat";
  priority: "P0" | "P1" | "P2" | "P3";
  project?: string;
  source: "codex" | "script" | "automation" | "user" | "channel";
  requiresReply: boolean;
  preferredChannel: "auto" | "dingtalk" | "lark" | "both";
  title: string;
  body: string;
  context?: Record<string, unknown>;
};
```

## Routing Rules

Default routing:

```text
P0 -> DingTalk + Lark
P1 -> DingTalk
P2 -> Lark, or DingTalk digest if mobile action is useful
P3 -> Local archive only
```

Overrides:

- If the user starts a task in a channel, reply progress in that same channel unless priority escalates.
- If a confirmation is required, send it to DingTalk by default.
- If DingTalk delivery fails, fall back to Lark for P0/P1.
- If both channels are active for the same task, deduplicate notifications by envelope id.
- If the user explicitly asks to archive or move an item to a channel, honor that as a one-off routing override.
- If the user asks for a persistent route change, treat it as policy config and require confirmation.

See [Global Communication Rules](communication-rules.md) for the shared command grammar, ambiguity rules, confirmation semantics, and message formatting rules.

Confirmed event routing:

| Event | Priority | Route |
|---|---|---|
| Security/account/destructive decision | P0 | DingTalk + Lark |
| Normal confirmation | P1 | DingTalk |
| Task failure | P1 | DingTalk |
| Automation abnormal result | P1 | DingTalk |
| User-visible task completion | P1/P2 | Starting channel if short/actionable, otherwise Lark |
| Daily/project summary | P2 | Lark |
| Mobile action digest | P1/P2 | DingTalk |
| Verbose logs | P3 | Local store |

## User Interaction Model

Do not require users to remember internal IDs.

Use these references in order:

1. Current task or latest confirmation when context is obvious.
2. Visible short number from the latest status list.
3. Human-readable task name.
4. Stable internal ID only as a fallback/debug handle.

Examples:

```text
同意
不同意
补充 只允许改项目配置
取消这个任务
取消 1
查看 Mail
今天有什么异常
把第二个处理掉
这条发飞书归档
```

## Core Modules

| Module | Responsibility |
|---|---|
| Task Core | Task lifecycle, names, status, current-task context |
| Confirmation Queue | Pending decisions, replies, approvals, rejection handling |
| Notification Store | Persist all routed envelopes and delivery attempts |
| Routing Policy | Decide channel, priority, fanout, fallback, dedupe |
| Channel Registry | Register Lark, DingTalk, and future adapters |
| Adapter Interface | Normalize incoming messages and send outgoing messages |

## System Boundary

Channel Hub should be the only component that knows about task state, confirmation state, routing policy, and delivery history.

Recommended boundary:

```text
Codex / scripts / automations
        |
        v
Channel Hub API
        |
        +-- Task Core
        +-- Confirmation Queue
        +-- Routing Policy
        +-- Notification Store
        |
        v
Channel Registry
        |
        +-- DingTalk Adapter
        +-- Lark Adapter
```

Channel adapters may know how to authenticate, receive messages, format platform payloads, and send messages. They should not decide whether a task is current, whether a confirmation is valid, or whether an item is urgent.

## Runtime Shape

Start with one local Windows service or long-running local process. This keeps credentials and local automation integration simple.

Initial responsibilities:

- Accept outbound envelopes from local tools over HTTP or a local IPC mechanism.
- Receive inbound channel messages from adapters.
- Persist every envelope, delivery attempt, reply, and decision.
- Rebuild current task and pending confirmation context after restart.
- Apply routing policy consistently across Lark and DingTalk.

This is intentionally not a distributed service yet. If the hub later moves to a LAN/server host, the API and adapter boundaries should stay the same.

## Data Model

Minimum durable entities:

```ts
type HubTask = {
  id: string;
  visibleNo: number;
  name: string;
  project?: string;
  status: "queued" | "running" | "blocked" | "waiting_confirmation" | "completed" | "failed" | "cancelled";
  sourceChannel?: "lark" | "dingtalk";
  current: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

type Confirmation = {
  id: string;
  taskId?: string;
  visibleNo: number;
  title: string;
  body: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  allowedActions: Array<"approve" | "reject" | "modify" | "cancel">;
  requestedBy: "codex" | "script" | "automation" | "user";
  resolvedByChannel?: "lark" | "dingtalk";
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  context?: Record<string, unknown>;
};

type DeliveryAttempt = {
  id: string;
  envelopeId: string;
  channel: "lark" | "dingtalk";
  status: "pending" | "sent" | "failed" | "deduped" | "skipped";
  platformMessageId?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
};
```

Use SQLite for the first implementation. It is enough for local durability, easy inspection, and low operational cost.

## Routing Decision Flow

Routing should be deterministic and auditable:

```text
1. Normalize event into ChannelEnvelope.
2. Resolve task context:
   - current task
   - explicit visible number
   - task name
   - internal id fallback
3. Resolve priority:
   - explicit priority on envelope
   - message type default
   - escalation rules
4. Choose target channels:
   - preferredChannel override
   - default priority route
   - source-channel continuity
   - quiet-hours and digest policy
5. Check dedupe:
   - same envelope id
   - same task + same event type + recent time window
6. Send through adapters.
7. Persist delivery attempts.
8. Apply fallback if required.
```

Priority should not be inferred from wording alone for dangerous operations. Account, credential, destructive filesystem, billing, and irreversible actions should explicitly become P0 or confirmation-required P1.

## Incoming Message Handling

Incoming channel messages should be parsed into intents before touching task state.

```ts
type IncomingIntent =
  | { kind: "approve"; target?: TaskReference }
  | { kind: "reject"; target?: TaskReference; reason?: string }
  | { kind: "modify"; target?: TaskReference; instruction: string }
  | { kind: "cancel"; target?: TaskReference }
  | { kind: "status"; target?: TaskReference }
  | { kind: "route"; target?: TaskReference; channel: "lark" | "dingtalk" | "both" }
  | { kind: "chat"; text: string };

type TaskReference =
  | { kind: "current" }
  | { kind: "visible_no"; value: number }
  | { kind: "name"; value: string }
  | { kind: "internal_id"; value: string };
```

Resolution order must match the user interaction model. If a reply is ambiguous and could approve a risky action, the hub should ask a clarification instead of guessing.

## Confirmation Semantics

Confirmations are first-class hub objects, not channel messages.

Rules:

- A pending confirmation can be resolved from any registered channel.
- Only the latest obvious confirmation may be resolved by bare replies like `同意` or `不同意`.
- If multiple confirmations are pending, require a visible number or name.
- A modification reply should keep the confirmation pending unless the user clearly approves the modified action.
- Expired confirmations should reject late approvals and ask the user to restart or restate the request.
- Every approval/rejection should be persisted with channel, timestamp, and original message text.

## Dedupe Policy

Use two layers:

1. Strict dedupe by `envelope.id`.
2. Soft dedupe by semantic key:

```text
semanticKey = taskId + type + priority + title
dedupeWindow = 5 minutes for P1/P2, 30 seconds for P0
```

P0 messages should still fan out to both channels, but repeated P0 messages for the same unresolved blocker should update or reference the existing alert instead of creating noise.

## Digest Policy

Digests are generated by Channel Hub from stored events.

Initial digest types:

| Digest | Default Channel | Contents |
|---|---|---|
| Daily status | Lark | Completed, failed, blocked, pending confirmations |
| Mobile action list | DingTalk | Items needing user action today |
| Project summary | Lark | Per-project task movement and notable automation results |

P2 items can either be sent immediately or batched into a digest. The rule should be explicit in config because some low-priority items are still mobile-actionable.

## Policy Config Shape

Extend the initial YAML into a policy that can support project overrides:

The canonical example lives in [Routing Policy Example](routing-policy.example.yaml).

```yaml
default:
  routes:
    P0: [dingtalk, lark]
    P1: [dingtalk]
    P2: [lark]
    P3: []
  fallback:
    dingtalk: [lark]
    lark: [dingtalk]
  dedupe:
    P0: 30s
    P1: 5m
    P2: 5m
  confirmations:
    defaultChannel: dingtalk
    allowCrossChannelResolution: true

projects:
  channel-hub:
    routes:
      P1: [dingtalk]
      P2: [lark]
```

Keep this config small at first. Avoid building a rules engine until real routing exceptions appear.

## Adapter Boundary

Each channel adapter should implement:

```ts
type ChannelAdapter = {
  name: "lark" | "dingtalk";
  start(input: { onMessage: (message: IncomingChannelMessage) => Promise<void> }): Promise<void>;
  send(message: OutgoingChannelMessage): Promise<DeliveryResult>;
};
```

Adapters should not own task semantics. They only translate between platform-specific payloads and hub-normalized messages.

Recommended normalized message types:

```ts
type IncomingChannelMessage = {
  id: string;
  channel: "lark" | "dingtalk";
  senderId: string;
  text: string;
  threadId?: string;
  replyToMessageId?: string;
  receivedAt: string;
  raw?: unknown;
};

type OutgoingChannelMessage = {
  envelopeId: string;
  channel: "lark" | "dingtalk";
  title: string;
  body: string;
  priority: "P0" | "P1" | "P2" | "P3";
  taskId?: string;
  confirmationId?: string;
  actions?: Array<{
    label: string;
    value: string;
    style?: "primary" | "danger" | "default";
  }>;
  metadata?: Record<string, unknown>;
};
```

Adapters can render action buttons if the platform supports them. If not, they should render short textual commands such as `同意`, `不同意`, `取消 2`.

## API Surface

Minimum local API:

```text
POST /envelopes
POST /tasks
PATCH /tasks/:id
POST /confirmations
POST /incoming/:channel
GET /status
GET /confirmations/pending
```

The first useful integration point is `POST /envelopes`, because local scripts and automations can start sending normalized notifications before the full task core exists.

## Failure Handling

| Failure | Handling |
|---|---|
| DingTalk send fails for P0/P1 | Persist failure, send to Lark fallback, mark degraded |
| Lark send fails for P0 | Persist failure, keep DingTalk result, expose in status |
| Both channels fail | Keep local pending alert and surface in local status/API |
| Adapter receives duplicate inbound event | Ignore by platform message id |
| Hub restarts | Reload pending confirmations, current task, and unsent P0/P1 attempts |
| Ambiguous approval | Ask clarification; do not approve risky action |

## MVP Scope

MVP should prove cross-channel routing without overbuilding:

1. SQLite store for envelopes, delivery attempts, tasks, confirmations.
2. Local API for creating envelopes and confirmations.
3. Routing policy with default priority routes, fallback, and strict dedupe.
4. One adapter wrapper for existing Lark implementation.
5. DingTalk adapter with send and inbound text handling.
6. Bare-reply confirmation handling: `同意`, `不同意`, `取消`.
7. Status command: `今天有什么异常`, `查看待确认`.

Defer:

- Multi-user permission model.
- Complex natural-language task search.
- Rich rules engine.
- Remote server deployment.
- Full project analytics.

## Initial Implementation Plan

1. Create `hub` core package with routing envelope types.
2. Move shared task and confirmation concepts from `channel/lark` into hub core.
3. Wrap existing Lark implementation as `LarkAdapter`.
4. Build `DingTalkAdapter` against the same adapter interface.
5. Add routing policy config:

```yaml
default:
  P0: [dingtalk, lark]
  P1: [dingtalk]
  P2: [lark]
  P3: []

fallback:
  dingtalk: [lark]
  lark: [dingtalk]
```

6. Add delivery dedupe and audit log.
7. Support cross-channel continuation: task created in Lark can be confirmed in DingTalk.

## Open Decisions

- Whether Channel Hub should run as one local Windows service or eventually become a small LAN/server service.
- Whether local API should be HTTP-only or also expose a CLI for scripts.
- How long notification and delivery audit logs should be retained.

Resolved:

- DingTalk is the default P1 channel.
- Lark is the default channel for daily/project summaries.
- P0 uses both channels.
- Text commands are sufficient for MVP; action buttons can be added later without changing semantics.

## Success Criteria

- User can start a task in one channel and confirm it in another.
- P0/P1 items reliably reach DingTalk on mobile.
- Lark remains useful for project history and fallback without becoming noisy.
- User never needs to remember long task or confirmation IDs for normal operation.
