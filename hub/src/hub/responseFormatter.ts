import type { ChannelEnvelope } from "../domain.js";

export type NativeToolId = "feishu_document_read_analyze" | "feishu_sheet_read" | "smartbi_report_lookup";

export function formatNativeToolReply(input: { toolId: NativeToolId; title: string; text: string }): {
  title: string;
  text: string;
  actions?: ChannelEnvelope["actions"];
} {
  const text = compactReply(input.text);
  const failure = failureHint(input.toolId, text);
  if (failure) {
    return {
      title: input.title,
      text: failure,
      actions: [{ label: "再试一次", value: retryCommand(input.toolId), style: "default" }]
    };
  }
  return {
    title: input.title,
    text,
    actions: input.toolId === "smartbi_report_lookup" ? undefined : followUpActions(input.toolId)
  };
}

export function formatTaskCreatedReply(input: { taskName: string; status: string }): string {
  return [`已开始：${input.taskName}`, `状态：${input.status}`, "我会只回关键结论；如果卡住，会告诉你只缺什么。"].join("\n");
}

export function compactReply(text: string, maxChars = 900): string {
  const normalized = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(debug|trace|stdout|stderr|cmd|command|script|path)\b/i.test(line))
    .join("\n");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}\n...`;
}

export function oneMissingKeyReply(input: { reason: string; missing: string; next?: string }): string {
  return [
    `没查全：${input.reason}`,
    `只缺：${input.missing}`,
    input.next ? `下一步：${input.next}` : undefined
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function failureHint(toolId: NativeToolId, text: string): string | undefined {
  if (/^(查到了|我读到|已读到|读取到了)/.test(text)) return undefined;
  if (!/(失败|没有|没读到|没查到|缺|permission|forbidden|403|not authorized|token|login|授权|权限|配置)/i.test(text)) {
    return undefined;
  }
  if (toolId === "feishu_document_read_analyze") {
    return oneMissingKeyReply({
      reason: "飞书正文还没有读出来",
      missing: "文档授权给当前飞书 CLI 账号，或补 FEISHU_APP_ID/FEISHU_APP_SECRET 的应用权限",
      next: "授权补上后，直接把同一个链接再发我"
    });
  }
  if (toolId === "feishu_sheet_read") {
    return oneMissingKeyReply({
      reason: "飞书表格还没有读出来",
      missing: "飞书 CLI 登录态、表格授权或可读 sheet token",
      next: "确认表格可访问后，重新发链接即可"
    });
  }
  return oneMissingKeyReply({
    reason: "本地 BI 元数据没匹配到足够结果",
    missing: "最新 SmartBI 导出文件或 live 抓取入口",
    next: "补一份导出或允许后续接 live 查询工具"
  });
}

function followUpActions(toolId: NativeToolId): ChannelEnvelope["actions"] {
  if (toolId === "feishu_document_read_analyze") {
    return [
      { label: "提炼结论", value: "继续提炼这个文档的核心结论", style: "primary" },
      { label: "找风险", value: "继续找这个文档的风险和缺口", style: "default" }
    ];
  }
  if (toolId === "feishu_sheet_read") {
    return [
      { label: "概括表格", value: "继续概括这个表格", style: "primary" },
      { label: "找异常", value: "继续检查这个表格的异常", style: "default" }
    ];
  }
  return [
    { label: "展开目录", value: "继续展开 BI 目录", style: "primary" },
    { label: "找缺口", value: "继续检查 BI 元数据缺口", style: "default" }
  ];
}

function retryCommand(toolId: NativeToolId): string {
  if (toolId === "feishu_document_read_analyze") return "重试飞书文档读取";
  if (toolId === "feishu_sheet_read") return "重试飞书表格读取";
  return "重试 BI 查询";
}
