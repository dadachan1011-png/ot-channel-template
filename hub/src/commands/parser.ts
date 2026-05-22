import type { ChannelName } from "../domain.js";

export type RouteMode = "fast_lookup" | "planned_task" | "direct_action";
export type FastLookupToolId = "feishu_document_read_analyze" | "feishu_sheet_read" | "smartbi_report_lookup";

export type ParsedCommand =
  | { kind: "ping" }
  | { kind: "channels_status" }
  | { kind: "status"; target?: string; abnormalOnly?: boolean }
  | { kind: "codex"; prompt: string; name?: string; reasoningEffort?: string; routeMode?: RouteMode; toolId?: FastLookupToolId }
  | { kind: "cancel"; target?: string }
  | { kind: "confirm"; target?: string; answer: "yes" | "no" }
  | { kind: "reply"; target?: string; text: string }
  | { kind: "route"; target?: string; channel: ChannelName | "both"; persistent: boolean }
  | { kind: "quiet"; scope: "today" | "low_priority" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string };

export function parseCommand(input: string): ParsedCommand {
  const text = input.trim();

  if (!text) return { kind: "unknown", raw: input };
  if (text === "/ping" || /^ping$/i.test(text)) return { kind: "ping" };
  if (/^(doctor|\/doctor|诊断|健康检查|渠道状态|channel status|channels status|\/channels status)$/i.test(text)) return { kind: "channels_status" };
  if (/^(帮助|怎么回复|你能做什么)$/.test(text)) return { kind: "help" };

  if (text === "/status") return { kind: "status" };
  if (text.startsWith("/status ")) {
    const target = text.slice("/status ".length).trim();
    return target ? { kind: "status", target } : { kind: "status" };
  }

  if (/^(今天有什么异常|有什么失败|待处理有哪些)$/.test(text)) {
    return { kind: "status", abnormalOnly: true };
  }

  const naturalStatus = text.match(/^(查看|看一下|状态|查一下)(?:\s+(.+))?$/);
  if (naturalStatus) {
    return naturalStatus[2]?.trim()
      ? { kind: "status", target: naturalStatus[2].trim() }
      : { kind: "status" };
  }

  if (text.startsWith("/codex ")) return parseCodex(text.slice("/codex ".length).trim());

  if (text === "/cancel") return { kind: "cancel" };
  if (text.startsWith("/cancel ")) {
    const target = text.slice("/cancel ".length).trim();
    return target ? { kind: "cancel", target } : { kind: "cancel" };
  }

  const naturalCancel = text.match(/^(取消|停止|停掉)(?:\s+(.+)|这个任务|当前任务)?$/);
  if (naturalCancel) {
    return naturalCancel[2]?.trim() ? { kind: "cancel", target: naturalCancel[2].trim() } : { kind: "cancel" };
  }

  const simpleConfirmMatch = text.match(/^\/confirm\s+(yes|no)$/i);
  if (simpleConfirmMatch) return { kind: "confirm", answer: simpleConfirmMatch[1].toLowerCase() as "yes" | "no" };

  const confirmMatch = text.match(/^\/confirm\s+(\S+)\s+(yes|no)$/i);
  if (confirmMatch) {
    return {
      kind: "confirm",
      target: confirmMatch[1],
      answer: confirmMatch[2].toLowerCase() as "yes" | "no"
    };
  }

  const naturalApprove = text.match(/^(同意|可以|确认|继续|允许)(?:\s+(.+))?$/);
  if (naturalApprove) {
    return naturalApprove[2]?.trim()
      ? { kind: "confirm", target: naturalApprove[2].trim(), answer: "yes" }
      : { kind: "confirm", answer: "yes" };
  }

  const naturalReject = text.match(/^(不同意|拒绝|不要|不行|取消确认)(?:\s+(.+))?$/);
  if (naturalReject) {
    return naturalReject[2]?.trim()
      ? { kind: "confirm", target: naturalReject[2].trim(), answer: "no" }
      : { kind: "confirm", answer: "no" };
  }

  if (text.startsWith("/reply ")) return parseReply(text.slice("/reply ".length).trim());

  const naturalReply = text.match(/^(补充|说明|回复)(?:\s+(\S+))?\s*[:：]?\s+([\s\S]+)$/);
  if (naturalReply) {
    return naturalReply[2]
      ? { kind: "reply", target: naturalReply[2].trim(), text: naturalReply[3].trim() }
      : { kind: "reply", text: naturalReply[3].trim() };
  }

  if (/^(这条发飞书归档|发飞书留档)$/.test(text)) return { kind: "route", channel: "lark", persistent: false };
  if (/^(这条发钉钉提醒|钉钉提醒我)$/.test(text)) return { kind: "route", channel: "dingtalk", persistent: false };
  if (/^(这个双发|钉钉飞书都发)$/.test(text)) return { kind: "route", channel: "both", persistent: false };

  const persistentRoute = text.match(/^以后(.+?)发(飞书|钉钉)$/);
  if (persistentRoute) {
    return {
      kind: "route",
      target: persistentRoute[1].trim(),
      channel: persistentRoute[2] === "飞书" ? "lark" : "dingtalk",
      persistent: true
    };
  }

  if (/^(今天别打扰|低优先级先别推)$/.test(text)) {
    return { kind: "quiet", scope: text === "今天别打扰" ? "today" : "low_priority" };
  }

  return { kind: "unknown", raw: input };
}

function parseReply(rest: string): ParsedCommand {
  const explicitMatch = rest.match(/^(c_\S+)\s+([\s\S]+)$/);
  if (explicitMatch) return { kind: "reply", target: explicitMatch[1], text: explicitMatch[2].trim() };

  const numberedMatch = rest.match(/^(\d+)\s+([\s\S]+)$/);
  if (numberedMatch) return { kind: "reply", target: numberedMatch[1], text: numberedMatch[2].trim() };

  return rest ? { kind: "reply", text: rest } : { kind: "unknown", raw: "/reply" };
}

function parseCodex(input: string): ParsedCommand {
  const named = input.match(/^(?:名称|任务|名字|name)\s*[:：]\s*(.+?)(?:\n|;|；)\s*([\s\S]+)$/i);
  if (named) return { kind: "codex", name: named[1].trim(), prompt: named[2].trim() };
  return { kind: "codex", prompt: input.trim(), name: inferTaskName(input) };
}

function inferTaskName(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const withoutPrefix = normalized.replace(/^(帮我|请|麻烦你|你来|给我)/, "");
  return withoutPrefix.slice(0, 24) || "未命名任务";
}
