# Global Communication Rules

## Goal

Unify DingTalk and Lark into one communication model.

The user should not need to remember which channel started a task, which adapter owns a confirmation, or any long internal ID. DingTalk and Lark are only delivery surfaces. Channel Hub owns task context, confirmation state, routing, and history.

## Confirmed Channel Roles

| Channel | Role | Use For | Avoid |
|---|---|---|---|
| DingTalk | Primary action channel | Urgent alerts, confirmations, failures, mobile task control, short decisions | Long logs, verbose project history |
| Lark | Project context channel | Project progress, daily summaries, automation reports, fallback, searchable history | High-frequency interruptions |
| Local store | Source of truth | Full event history, task state, confirmation queue, delivery attempts | User-facing conversation |

Default principle:

- If the user must act now, use DingTalk.
- If the user may read later, use Lark.
- If the item is critical or account/security/destructive, use both.
- If it is only diagnostic noise, store it locally.

## Input And Output Contract

Input is channel-neutral. The user can send the same command or natural reply in DingTalk or Lark.

Output is hub-routed. Channel Hub decides where to send messages based on priority, decision need, risk, and context.

| Direction | Owner | DingTalk | Lark | Rule |
|---|---|---|---|---|
| User input | User | Supported | Supported | Same commands and natural replies work in both channels |
| Task creation | User | Supported | Supported | `/codex ...` works in either channel |
| Status query | User | Supported | Supported | `/status`, `查看`, `今天有什么异常` work in either channel |
| Confirmation reply | User | Supported | Supported | `同意`, `不同意`, `补充 ...` can resolve hub confirmations from either channel |
| Cancel / modify | User | Supported | Supported | `取消`, `补充`, targeted visible numbers work in either channel |
| Normal progress output | Hub | Starting channel if task started in DingTalk | Starting channel if task started in Lark | Preserve conversation continuity unless priority escalates |
| Decision request output | Hub | Default route | Fallback/context only | Anything needing user choice or approval goes to DingTalk |
| High-risk decision output | Hub | Required | Required | P0 double-send for security/account/destructive/credential/long-term config |
| Automation summary output | Hub | Only if action is needed | Default route | Pure summaries go to Lark; decisions/abnormal action items go to DingTalk |
| Task failure output | Hub | Default route | Fallback or project archive | Failure is P1 unless it is only historical context |
| Daily/project summary output | Hub | Action digest only | Default route | Lark gets context; DingTalk gets only items requiring action today |
| Conversation completion summary | Hub | Only if failed/blocked/needs decision | Default route | Every completed working session writes a summary; ordinary completion goes to Lark |
| Verbose logs output | Hub | No | No | Store locally; send summary or link/reference only |

Short version:

```text
输入：钉钉、飞书都能说同一套话。
输出：Hub 控制路由；决策到钉钉，总结到飞书，高风险双发，日志本地存。
```

## Online Acknowledgement

When a valid user message enters DingTalk or Lark and the bridge is about to hand it to Channel Hub, the channel adapter should immediately reply with a short acknowledgement emoji.

Default:

```text
👀
```

Rules:

- This acknowledgement only means "received and processing"; it is not the final answer.
- It must be sent by the bridge before the message is forwarded to Hub, so the user gets feedback even when Codex/LLM interpretation takes time.
- It applies to both DingTalk and Lark when `ACK_ENABLED=true`.
- It should only be sent for authorized private user messages that will be processed by Hub.
- Final responses, confirmations, summaries, and failures are still routed by Hub using the normal priority matrix.
- Current implementation uses a text reply for cross-platform reliability. If a platform later exposes stable reaction APIs, the adapter can switch to a real reaction without changing Hub semantics.
- Do not remove the acknowledgement before the final reply is visible. If a future adapter supports removal-after-reply, remove it only after final delivery succeeds.

Configuration:

```dotenv
ACK_ENABLED=true
ACK_EMOJI=👀
TYPING_ENABLED=true
TYPING_AFTER_MS=5000
LONG_TYPING_AFTER_MS=30000
```

Design reference:

- OpenClaw-style channels use `ackReaction` to show an inbound message has been received, `typingReaction` for longer processing state, and `removeAckAfterReply` to optionally clear the marker after the answer is sent.
- Channel Hub adopts the same user-experience contract but keeps it adapter-local: acknowledgement belongs to the channel bridge; routing and task semantics belong to Hub.

## OpenClaw-Style Channel Lifecycle

Channel Hub uses a deterministic lifecycle inspired by OpenClaw channels:

1. The channel bridge receives an authorized message and immediately sends ACK.
2. Hub groups short consecutive messages from the same session for `HUB_INCOMING_DEBOUNCE_MS` before intent parsing.
3. If Hub processing is slow, the bridge sends typing/status text at the configured thresholds.
4. Hub emits the final routed reply, confirmation, report, or error.

Session keys isolate context:

```text
dingtalk:direct:<user>
dingtalk:group:<conversation>
lark:direct:<user>
lark:group:<chat>
```

Current native platform support is intentionally conservative. Hub records structured actions and channel capabilities, while the bridges render text fallbacks such as `同意 1` until platform-specific cards or reactions are enabled.

Useful diagnostics:

```text
渠道状态
```

API:

```text
GET /channels/status
```

## Priority Rules

| Priority | Meaning | Default Route | Reply Expected |
|---|---|---|---|
| P0 | Immediate interruption | DingTalk + Lark | Usually yes |
| P1 | Actionable daily signal | DingTalk | Often yes |
| P2 | Useful project signal | Lark | Usually no |
| P3 | Archive/detail only | Local store | No |

P0 examples:

- Security/account decisions.
- Destructive filesystem or data operations.
- Credential, billing, permission, or long-term configuration changes.
- A task is blocked and cannot continue without the user.

P1 examples:

- Confirmation required for a normal task.
- Task failed and needs attention.
- Automation abnormal result.
- A user-started task completed and the result is short enough to read on mobile.

P2 examples:

- Daily reports.
- Project scan summaries.
- Low-risk suggestions.
- Routine task completion where no action is needed.

P3 examples:

- Verbose command output.
- Stack traces already attached to a task/report.
- Repeated progress logs.
- Successful routine checks with no user value.

## Routing Matrix

This is the concrete routing contract for the first global version.

| Event | Priority | Route | Notes |
|---|---|---|---|
| Security/account/destructive decision | P0 | DingTalk + Lark | Must require explicit confirmation |
| Credential, billing, permission, long-term config change | P0 | DingTalk + Lark | Redact sensitive values |
| Task blocked by user decision | P0 or P1 | DingTalk, both if high-risk | Use P0 when the blocked action is risky |
| Normal confirmation required | P1 | DingTalk | Can be resolved from Lark too |
| Task failure | P1 | DingTalk | Include short error summary, store full logs locally |
| Automation abnormal result | P1 | DingTalk | Use Lark fallback if DingTalk fails |
| User-started task completion with short useful result | P1 | Starting channel or DingTalk | Prefer starting channel unless mobile action is needed |
| Routine task completion | P2 | Lark | No DingTalk push unless user is waiting there |
| Daily status summary | P2 | Lark | DingTalk gets only action list |
| Project progress summary | P2 | Lark | Good for searchable history |
| Mobile action list | P1/P2 digest | DingTalk | Only items needing action today |
| Verbose logs and detailed output | P3 | Local store | Link or summarize if needed |
| Repeated progress update | P3 or suppressed | Local store | Send only milestones |

If an event matches multiple rows, choose the highest priority.

## Conversation Style

All channels should use the same short, operational style.

Rules:

- Start with the result or requested decision.
- Keep messages short enough for mobile unless the route is Lark-only.
- Include a visible number when there are multiple tasks or confirmations.
- Prefer task names over IDs.
- Show internal IDs only for debugging or exact fallback.
- Do not ask the user to pick a channel for normal replies.
- Do not repeat full logs in chat. Store logs and send a summary.

Recommended message shape:

```text
需要确认：是否允许修改项目配置
任务：Channel Hub 路由设计
影响：会改 docs/routing-strategy.md

回复：同意 / 不同意 / 补充 只允许改文档
```

For lists:

```text
待处理：
1. Channel Hub 路由设计 - 等待确认
2. Mail 自动化检查 - 失败

可回复：同意 1 / 查看 2 / 取消 1
```

## Global Commands

These commands must behave the same in DingTalk and Lark.

| Intent | Supported Text |
|---|---|
| Health check | `/ping` |
| Create task | `/codex <task>` |
| Create named task | `/codex 名称: <task name>; <task>` |
| Status | `/status`, `状态`, `查看`, `今天有什么异常` |
| Target status | `/status <target>`, `查看 <target>` |
| Cancel | `/cancel`, `取消这个任务`, `取消 <target>` |
| Approve | `/confirm yes`, `同意`, `可以`, `确认`, `继续`, `允许` |
| Approve target | `/confirm <target> yes`, `同意 <target>` |
| Reject | `/confirm no`, `不同意`, `拒绝`, `不要`, `不行` |
| Reject target | `/confirm <target> no`, `不同意 <target>` |
| Add note | `/reply <text>`, `补充 <text>`, `说明 <text>` |
| Add note to target | `/reply <target> <text>`, `补充 <target> <text>` |
| Route/archive | `这条发飞书归档`, `这条发钉钉提醒`, `这个双发` |

`target` resolution order:

1. Current obvious task or latest obvious confirmation.
2. Visible number from the latest status list.
3. Human-readable task or confirmation name.
4. Internal ID.

## Natural Language Protocol

The existing Lark natural-language agreement is now global. DingTalk and Lark must parse these phrases the same way.

Implementation rule:

- Common natural speech is handled by a local semantic fast path.
- Codex interpretation is used for harder free-form conversation.
- Deterministic command parsing remains the fallback and safety net.
- The user should be able to speak naturally; commands are examples, not requirements.

Core rule:

```text
意图 + 可选目标 + 可选补充说明
```

Targets are optional when context is obvious. If the target is missing, the hub resolves it by current task, latest confirmation, visible number, task name, then internal ID.

| Intent | Natural Language | Meaning |
|---|---|---|
| Check status | `查看`, `状态`, `看一下`, `查一下` | Show current tasks and pending confirmations |
| Check target | `查看 Mail`, `状态 1`, `看一下 Channel Hub` | Show one task or confirmation |
| Check abnormalities | `今天有什么异常`, `有什么失败`, `待处理有哪些` | Show failed, blocked, abnormal, and pending-decision items |
| Approve | `同意`, `可以`, `确认`, `继续`, `允许` | Approve the latest obvious confirmation |
| Approve target | `同意 1`, `允许 Mail`, `继续 Channel Hub` | Approve the referenced confirmation/task |
| Reject | `不同意`, `拒绝`, `不要`, `不行` | Reject the latest obvious confirmation |
| Reject target | `不同意 1`, `拒绝 Mail` | Reject the referenced confirmation/task |
| Add constraint | `补充 只允许改项目配置`, `说明 不要动长期记忆` | Add constraints to the latest confirmation and keep it pending |
| Add target constraint | `补充 1 只允许改文档`, `说明 Mail 今天先跳过` | Add constraints to a specific confirmation/task |
| Cancel current | `取消`, `取消这个任务`, `停止`, `停掉` | Cancel the current obvious task |
| Cancel target | `取消 1`, `停止 Mail`, `停掉 Channel Hub` | Cancel the referenced task |
| Route to Lark | `这条发飞书归档`, `发飞书留档` | Send/copy this item to Lark for archive/context |
| Route to DingTalk | `这条发钉钉提醒`, `钉钉提醒我` | Send/copy this item to DingTalk as an action reminder |
| Double-send | `这个双发`, `钉钉飞书都发` | Send/copy this item to both channels |
| Quiet mode | `今天别打扰`, `低优先级先别推` | Suppress immediate P2 pushes; keep P0/P1 active |
| Help | `你能做什么`, `怎么回复`, `帮助` | Show available short replies based on current context |

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

## Natural Language Resolution Rules

The hub should handle natural language conservatively.

| Situation | Behavior |
|---|---|
| One pending confirmation, user says `同意` | Approve it |
| Multiple pending confirmations, user says `同意` | Ask which one: `同意 1 / 同意 2` |
| One active task, user says `取消这个任务` | Cancel it |
| Multiple active tasks, user says `取消` | Ask which one |
| User references a visible number | Resolve against the latest status list in that channel/user context |
| User references a task name | Prefer exact match, then active partial match |
| User replies `补充 ...` | Record the constraint; do not approve unless approval is explicit |
| User says `继续` on P0 or risky action | Ask for explicit confirmation if risk is not already clear |
| User asks `今天有什么异常` | Return failures, blocked tasks, abnormal automation results, and pending confirmations |

Natural language should never silently approve high-risk actions when the target is ambiguous.

## Codex Conversation Layer

Channel Hub should use the local Codex CLI to classify free-form input into one of these outcomes:

| Outcome | Behavior |
|---|---|
| Action intent | Convert the message into status, task, cancel, confirm, reply, route, or quiet intent |
| Conversational reply | Reply naturally when the user is giving feedback, asking for explanation, or discussing workflow |
| Clarification | Ask a short follow-up when target, risk, or intent is unclear |
| Safety stop | Refuse to infer approval for high-risk or ambiguous actions |

Codex receives only the minimal context needed:

- Incoming text and channel.
- Active task numbers, names, and status.
- Pending confirmation numbers, titles, and bodies.

Safety constraints:

- Explicit commands and exact short replies still work without Codex.
- If Codex is busy or unavailable, fall back to deterministic parsing.
- If confidence is low, reply with how to communicate instead of guessing.
- If multiple confirmations are pending, bare approval must ask which one.
- High-risk actions must be explicit and target-resolved.

## Ambiguity Rules

The hub may infer the target only when the consequence is low-risk and context is obvious.

Ask a clarification when:

- More than one confirmation is pending and the user replies `同意`.
- A reply could approve a P0 action.
- The target text matches multiple active tasks.
- The user says `继续` after the task has changed since the last prompt.
- A confirmation has expired.

Clarification should be short:

```text
有 2 个待确认。请回复：同意 1 / 同意 2
```

## Confirmation Rules

Confirmations belong to Channel Hub, not DingTalk or Lark.

Rules:

- A confirmation can be created from any source and resolved from any channel.
- A confirmation should include title, task, impact, recommended action, and allowed replies.
- A bare `同意` or `不同意` can resolve only the latest obvious pending confirmation.
- `补充 ...` records constraints and keeps the confirmation pending unless the user clearly approves.
- Rejections should stop or mark the related action as blocked, not silently continue.
- Every decision must record channel, original text, timestamp, and resolved confirmation id.

## Task Continuation Rules

When the user starts a task in one channel:

- Acknowledgement and normal progress stay in the starting channel.
- P0 escalations always go to both channels.
- P1 confirmations default to DingTalk, even if the task started in Lark.
- P2 completion summaries default to Lark, unless the task started in DingTalk and the result is short/actionable.
- The user can continue from either channel after the hub resolves the target.

Starting-channel continuity is a convenience rule, not a safety rule. Priority and confirmation policy win when they conflict.

Examples:

```text
Lark: /codex 名称: Mail 检查; 检查今天异常
DingTalk: 同意
Lark: 查看 Mail 检查
```

```text
DingTalk: /codex 重启本地桥接
Lark: 查看 1
DingTalk: 取消这个任务
```

## Routing Overrides

The user can override routing in natural language:

| User Says | Hub Behavior |
|---|---|
| `这条发飞书归档` | Send or copy the item to Lark and mark as archived |
| `这条发钉钉提醒` | Send to DingTalk if not already sent |
| `这个双发` | Send to both channels |
| `以后这个项目发飞书` | Create or suggest a project route override |
| `今天别打扰` | Suppress P2 immediate sends; keep P0/P1 active |

Long-term routing changes should be treated as configuration changes. The hub should confirm them before persisting.

## Message Formatting

DingTalk:

- Short first line.
- No long logs.
- Prefer action choices and visible numbers.
- Include only the immediate next replies.

Lark:

- Better for project summaries and context.
- Can include a longer body, but still summarize first.
- Use visible numbers for open tasks and confirmations.
- Keep detailed logs linked or stored, not pasted by default.

Local store:

- Store full raw payloads, parsed intents, routing decisions, delivery attempts, and decisions.
- Keep enough history to reconstruct why a message was sent.

## Noise Control

Progress updates:

- Send at most once every 15 seconds per active task.
- Skip progress messages that do not add new information.
- For long-running tasks, send milestone progress instead of every line.

Completion:

- P1 if user is waiting or the result needs action.
- P2 if it is useful but not urgent.
- P3 if it is routine success with no decision value.

Failures:

- P1 by default.
- P0 only if user intervention is required immediately or the failure affects account/security/data integrity.

## Conversation Close Sync

Every completed working session should submit a conversation summary to Channel Hub.

Routing:

| Summary Type | Priority | Route |
|---|---|---|
| Completed, no decision needed | P2 | Lark |
| Failed, blocked, or needs user decision | P1 | DingTalk |
| Security/account/destructive/long-term config risk | P0 | DingTalk + Lark |

Summary content:

- What changed.
- Current project state.
- Decisions made.
- Next actions.
- Whether user action is required.

API:

```text
POST /conversation-summaries
```

Minimum payload:

```json
{
  "title": "Channel Hub update",
  "project": "channel-hub",
  "status": "completed",
  "summary": "Implemented routing and communication rules.",
  "decisions": ["P1 goes to DingTalk"],
  "nextActions": ["Monitor bridge stability"],
  "needsDecision": false,
  "highRisk": false
}
```

## Safety Defaults

Require confirmation for:

- Destructive file operations outside the immediate task scope.
- Long-term config or memory changes.
- Credentials, tokens, account settings, billing, permission changes.
- Installing persistent services or startup items.
- Sending sensitive content to an external channel.

Do not include secrets in chat messages. Store only redacted summaries.

## MVP Contract

The first global implementation should preserve the existing Lark/DingTalk command set and move ownership into Channel Hub:

- One parser behavior across both channels.
- One task list.
- One confirmation queue.
- One visible numbering scheme per status response.
- One routing policy.
- One audit log.

Existing channel-specific bridges can remain temporarily as adapters, but task and confirmation semantics should migrate into the hub.

Implementation order:

1. Extract shared parser and intent types from the current Lark/DingTalk bridges.
2. Move task and confirmation state into Channel Hub.
3. Put routing decisions behind one policy function.
4. Wrap Lark and DingTalk as adapters.
5. Add cross-channel confirmation resolution and audit logs.
6. Move notification endpoints from channel-specific ports to the hub API.
