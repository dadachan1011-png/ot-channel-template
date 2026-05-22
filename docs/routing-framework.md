# Routing Framework

The Hub keeps routing simple: one interpreter decides the route, then one executor owns the result.

```mermaid
flowchart TD
  A["DingTalk/Lark message"] --> B["Bridge normalizes event"]
  B --> C["Hub receives IncomingChannelMessage"]
  C --> D{"Hard command?"}
  D -->|"yes: /ping /status /cancel /confirm"| E["Hub command handler"]
  D -->|"no"| F["Intent interpreter"]
  F --> G{"routeMode"}
  G -->|"assistant_reply"| H["LLM chat responder"]
  G -->|"fast_lookup + toolId"| I["Native fast tool"]
  G -->|"planned_task"| J["Codex planning + available tools"]
  G -->|"direct_action"| K["Codex execution with permission boundary"]
  G -->|"unknown"| H
  I --> L["Formatted concise reply"]
  J --> L
  K --> L
  H --> L
  E --> L
  L --> M["Bridge sends reply/notification"]
```

## Route Modes

- `assistant_reply`: normal chat, explanations, lightweight image/audio/document understanding.
- `fast_lookup`: mature, deterministic lookups. Requires a `toolId`; do not infer this from keyword scanning alone.
- `planned_task`: complex questions, unclear BI metric queries, multi-step reasoning, or anything needing Codex to inspect files.
- `direct_action`: local operation with side effects. Restrict to privileged senders and allowed workspace roots.
- hard commands: `/status`, `/cancel`, `/confirm`, `/reply`, `/ping`; handled by Hub directly.

## Design Rule

Use fast tools only when the workflow is stable and the expected answer shape is clear. Let Codex plan when the user asks for reasoning, diagnosis, code changes, ambiguous data interpretation, or cross-source analysis.
