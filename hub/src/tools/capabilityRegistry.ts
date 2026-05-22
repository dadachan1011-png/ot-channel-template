import type { HubState } from "../domain.js";
import type { InterpretedIntent } from "../intelligence/intent.js";

export type ToolCapability = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  handler: "codex_cli" | "native";
  risk: "read_only" | "write_local" | "external_action";
  outputStyle: string;
  category?: "chat" | "observe" | "execute" | "memory";
  requiredInputs?: string[];
  successSignals?: string[];
  failureOneMissingKey?: string;
  confirmationPolicy?: "none" | "owner" | "external_write" | "dangerous";
  savesMemory?: "never" | "session_only" | "group_auto" | "owner_confirmed";
};

export const toolCapabilities: ToolCapability[] = [
  {
    id: "feishu_document_read_analyze",
    name: "飞书文档读取与逻辑分析",
    description: "读取飞书 wiki/docx/doc 链接正文，并基于正文做结构、逻辑、风险和行动建议分析。",
    triggers: ["飞书", "wiki", "文档", "知识库", "链接", "逻辑分析"],
    handler: "native",
    risk: "read_only",
    outputStyle: "先给总判断，再列 3-5 条关键逻辑问题和建议；如果缺权限，明确说明缺飞书应用权限或文档授权。",
    category: "observe",
    requiredInputs: ["feishu wiki/doc url"],
    successSignals: ["document text read", "logic review returned"],
    failureOneMissingKey: "文档授权或飞书读取登录态",
    confirmationPolicy: "none",
    savesMemory: "never"
  },
  {
    id: "feishu_sheet_read",
    name: "飞书表格读取",
    description: "读取飞书 sheets/base 链接中的表格内容，用于临时查看、摘取字段、检查表格结构和做轻量分析。",
    triggers: ["飞书表格", "电子表格", "sheet", "sheets", "spreadsheet", "表格链接"],
    handler: "native",
    risk: "read_only",
    outputStyle: "先说明是否读到表格，再给关键行列摘要；不保存表格内容。",
    category: "observe",
    requiredInputs: ["feishu sheet/base url"],
    successSignals: ["sheet values read", "row/column summary returned"],
    failureOneMissingKey: "表格授权或 sheet token",
    confirmationPolicy: "none",
    savesMemory: "never"
  },
  {
    id: "smartbi_report_lookup",
    name: "SmartBI 报表目录与字段来源查询",
    description: "查询 SmartBI/BI 系统中的业务线、目录树、报表名称、报表路径、字段/指标来源、资源链接和基础元数据。",
    triggers: ["BI", "SmartBI", "报表", "目录", "业务线", "仪表盘", "看板", "字段", "指标", "取数", "口径", "GMV", "滚动GMV"],
    handler: "codex_cli",
    risk: "read_only",
    outputStyle: "先给查到/没查到的结论，再列目录树或字段来源；不要输出工程流水账。",
    category: "observe",
    requiredInputs: ["business line, report keyword, field name, or metric name"],
    successSignals: ["matched report entries", "matched fields"],
    failureOneMissingKey: "最新 BI 元数据导出或 live 查询入口",
    confirmationPolicy: "none",
    savesMemory: "never"
  },
  {
    id: "codex_project_investigation",
    name: "本地项目检查",
    description: "读取本地项目、文件、日志、任务状态和脚本结果，用于代码/项目/进度/故障分析。",
    triggers: ["项目", "代码", "日志", "进度", "任务", "报错", "文件"],
    handler: "codex_cli",
    risk: "read_only",
    outputStyle: "结论优先，证据只保留关键 2-5 条。",
    category: "execute",
    requiredInputs: ["project name or local path", "question"],
    successSignals: ["files/logs/processes inspected", "evidence-based result returned"],
    failureOneMissingKey: "目标项目名、路径或可读运行证据",
    confirmationPolicy: "owner",
    savesMemory: "session_only"
  },
  {
    id: "image_temporary_understanding",
    name: "图片临时识别",
    description: "临时读取钉钉图片，识别截图、页面、报错、表格或设计内容，并给出轻量分析；默认不沉淀长期记忆。",
    triggers: ["图片", "截图", "看图", "识别", "image"],
    handler: "native",
    risk: "read_only",
    outputStyle: "先说看到什么，再给最关键判断和下一步。",
    category: "chat",
    requiredInputs: ["image attachment"],
    successSignals: ["image downloaded", "vision response returned"],
    failureOneMissingKey: "可下载的临时图片 URL 或 media token",
    confirmationPolicy: "none",
    savesMemory: "never"
  },
  {
    id: "audio_temporary_transcription",
    name: "录音临时转写分析",
    description: "临时下载录音，转写后总结重点、风险、待办和业务线索；默认不保存原始音频。",
    triggers: ["录音", "语音", "音频", "转写", "audio"],
    handler: "native",
    risk: "read_only",
    outputStyle: "先给结论，再列重点、待办和不确定处。",
    category: "chat",
    requiredInputs: ["audio attachment"],
    successSignals: ["audio transcribed", "summary returned"],
    failureOneMissingKey: "可下载录音或转写命令/API 配置",
    confirmationPolicy: "none",
    savesMemory: "never"
  },
  {
    id: "memory_group_auto_review",
    name: "群记忆自动沉淀和每日复盘",
    description: "群聊只影响当前群的长期记忆和轻量上下文；自动写入后每天给 owner 复盘，可用保留/剔除做轻确认。",
    triggers: ["记住", "以后", "默认", "群记忆", "memory"],
    handler: "native",
    risk: "write_local",
    outputStyle: "日常不打扰，日报里列新增和可剔除项。",
    category: "memory",
    requiredInputs: ["group session key", "message text"],
    successSignals: ["candidate applied to group profile", "daily review generated"],
    failureOneMissingKey: "群 sessionKey",
    confirmationPolicy: "owner",
    savesMemory: "group_auto"
  },
  {
    id: "business_playbook_lookup",
    name: "业务 SOP 和 playbook 命中",
    description: "从 channel memory/kb/playbooks 中按关键词命中飞书、BI、录音、文档审查等固定流程，给 LLM 和工具分流提供上下文。",
    triggers: ["SOP", "playbook", "流程", "怎么查", "分析"],
    handler: "native",
    risk: "read_only",
    outputStyle: "把命中的 SOP 作为上下文，不在聊天里展开工程细节。",
    category: "observe",
    requiredInputs: ["user query"],
    successSignals: ["matching playbook included in memory context"],
    failureOneMissingKey: "对应业务 playbook 文档",
    confirmationPolicy: "none",
    savesMemory: "never"
  }
];

const biMetricPattern = /(滚动GMV|GMV-MTD达成率|GMV达成率|GMV目标|GMV|约课数|到课率|约课率|转化率|续费率|退费率|例子数|例子成本|ROI2?|消耗|成本|流水|达成率|ASP)/i;

export function formatToolCapabilitiesForPlanner(): string {
  return toolCapabilities
    .map(
      (tool) =>
        `- ${tool.id}: ${tool.description} category=${tool.category ?? "execute"} handler=${tool.handler} risk=${tool.risk} confirmation=${
          tool.confirmationPolicy ?? "owner"
        } missing=${tool.failureOneMissingKey ?? "-"} output=${tool.outputStyle}`
    )
    .join("\n");
}

export function parseRegisteredToolIntent(input: string, state?: HubState): InterpretedIntent | undefined {
  return parseFeishuSheetIntent(input) ?? parseSmartBiReportLookupIntent(input, state);
}

function parseFeishuSheetIntent(input: string): InterpretedIntent | undefined {
  const text = input.trim();
  if (!/feishu\.cn\/(?:sheets|base)\//i.test(text) && !/(飞书表格|电子表格|spreadsheet|sheet)/i.test(text)) return undefined;
  if (!/(读|看|查|检查|分析|打开|读取|内容|表格)/.test(text)) return undefined;
  return {
    kind: "codex",
    name: "读取飞书表格",
    routeMode: "fast_lookup",
    toolId: "feishu_sheet_read",
    prompt: [
      "你正在通过 Channel Hub 的注册工具能力执行任务：feishu_sheet_read（飞书表格读取）。",
      `用户原始请求：${text}`,
      "执行要求：临时读取飞书表格内容，给出关键行列摘要；不要保存表格内容。"
    ].join("\n")
  };
}

function parseSmartBiReportLookupIntent(input: string, state?: HubState): InterpretedIntent | undefined {
  const text = input.trim();
  const compact = text.replace(/\s+/g, "");
  const mentionsBi = /(BI|SmartBI|报表|仪表盘|看板)/i.test(compact);
  const asksFieldSource = /(字段|指标|取数|口径|来源|从.*报表|哪个报表|什么报表|哪些报表|哪里看|哪里查|可以在.*报表|field|metric|column)/i.test(compact);
  const mentionsKnownMetric = biMetricPattern.test(compact);
  const asksMetricValue = isSmartBiMetricValueQuery(compact);
  const shortMetricQuery = mentionsKnownMetric && compact.length <= 24;
  const metricReportQuestion = mentionsKnownMetric && /(报表|哪里|哪个|什么|哪些|看到|看|查|取|来源)/.test(compact);
  const shortFollowUp =
    hasRecentBiContext(state) && compact.length <= 24 && isBiLikeShortFollowUp(compact) && /^[\u4e00-\u9fa5A-Za-z0-9_\-]+$/i.test(compact);
  const needsCodexPlanning = shouldPlanSmartBiQuery(compact, { asksMetricValue, shortMetricQuery, shortFollowUp });

  if (!mentionsBi && !asksFieldSource && !mentionsKnownMetric && !metricReportQuestion && !shortFollowUp) return undefined;
  if (!shortMetricQuery && !metricReportQuestion && !shortFollowUp && !asksMetricValue) {
    if (!/(查|查询|看|看下|看一下|找|列出|整理|目录|业务线|路径|链接|清单|定位|获取|来源|取数|字段|指标|口径|报表|多少|几|有多少)/.test(compact)) {
      return undefined;
    }
  }

  return {
    kind: "codex",
    name: inferSmartBiTaskName(text),
    prompt: needsCodexPlanning ? buildSmartBiPlannedLookupPrompt(text) : buildSmartBiReportLookupPrompt(text),
    routeMode: needsCodexPlanning ? "planned_task" : "fast_lookup",
    toolId: needsCodexPlanning ? undefined : "smartbi_report_lookup",
    reasoningEffort: needsCodexPlanning ? "medium" : undefined
  };
}

function shouldPlanSmartBiQuery(
  compact: string,
  flags: {
    asksMetricValue: boolean;
    shortMetricQuery: boolean;
    shortFollowUp: boolean;
  }
): boolean {
  if (flags.asksMetricValue) return true;
  if (flags.shortMetricQuery || flags.shortFollowUp) return false;
  if (/(销售|售前|服务|转介绍|退费|续费|TMK|CC|LP|场景|链路|核心|优先|适合|应该|推荐|哪个更|怎么看|看什么)/i.test(compact)) return true;
  if (/(什么报表|哪个报表|哪些报表|哪里看|哪里查|可以在.*报表)/.test(compact)) return true;
  return false;
}

function isSmartBiMetricValueQuery(compact: string): boolean {
  if (!biMetricPattern.test(compact)) return false;
  const asksValue = /(多少|几|有多少|是多少|总量|金额|数值|数据|今天|昨日|昨天|本日|本周|本月|当日|当月|当前|实时|现在)/.test(compact);
  const asksLocation = /(报表|哪里|哪个|什么|哪些|看到|看|查|取|来源|字段|口径)/.test(compact);
  return asksValue && !asksLocation;
}

function hasRecentBiContext(state?: HubState): boolean {
  const recent = state?.incomingMessages.slice(-8) ?? [];
  return recent.some((message) => /(BI|SmartBI|报表|字段|指标|取数|口径|来源|滚动GMV|GMV|约课数|到课率|ROI)/i.test(message.text));
}

function isBiLikeShortFollowUp(compact: string): boolean {
  if (/(什么|哪个|哪些|哪里|多少|有多少|今天|昨天|本月|本周|可以|怎么|为什么|在忙|忙啥|干嘛)/.test(compact)) return false;
  if (biMetricPattern.test(compact)) return true;
  return /(GMV|ROI|字段|指标|报表|链接|口径|来源|取数|率|数|金额|成本|消耗|流水|转化|续费|退费|到课|约课)/i.test(compact);
}

function inferSmartBiTaskName(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (isSmartBiMetricValueQuery(normalized.replace(/\s+/g, ""))) return "查询 BI 指标数值";
  if (/(字段|指标|口径|取数|来源|哪个报表|什么报表|哪里看|哪里查|field|metric|column|滚动GMV|GMV|约课数|到课率|ROI)/i.test(normalized)) {
    return "查询 BI 字段来源";
  }
  if (/海外/.test(normalized) && /报表|BI|SmartBI/i.test(normalized)) return "查询 BI 海外业务线报表目录";
  return normalized.replace(/^(帮我|请|麻烦你|你来|给我)\s*/i, "").slice(0, 24) || "查询 BI 报表目录";
}

function buildSmartBiReportLookupPrompt(userText: string): string {
  return [
    "你正在通过 Channel Hub 的注册工具能力执行任务：smartbi_report_lookup（SmartBI 报表目录与字段来源查询）。",
    `用户原始请求：${userText}`,
    "目标：优先查本地 BI 元数据，直接回答字段/指标出现在哪些报表、报表名、路径、命中字段和筛选器。",
    "如果用户只发了一个指标名，也按字段来源查询处理，不要回泛泛建议。",
    "输出要求：第一行给结论；查到字段来源就列最可能的 3-6 张报表；不要输出工程流水账。"
  ].join("\n");
}

function buildSmartBiPlannedLookupPrompt(userText: string): string {
  return [
    "你正在处理一个 BI/SmartBI 查询。这里要让 Codex 先做业务理解和执行规划，再使用本地 BI 元数据完成查询；不要把 native 工具的关键词结果直接当最终答案。",
    `用户原始请求：${userText}`,
    "工作方式：",
    "0. 先判断用户是在问“字段/报表在哪里”，还是在问“某个指标现在/今天/本月是多少”。如果是问数值，目标是查真实数据，不要只返回报表清单。",
    "1. 先理解用户真正要解决的业务问题，区分字段名、同义字段、业务场景和路径偏好。",
    "2. 再读取本地 BI 元数据：优先使用 BI_KNOWLEDGE_FILES 配置；未配置时读取 memory/kb/bi/ 下的 report_profiles_v2.json、kb_bi_business_data_map.json、report_knowledge.json。",
    "3. 用字段候选召回作为证据，但最终排序必须结合业务语义：报表路径、报表名称、字段同义词、报表类型和用户场景。",
    "4. 如果用户问的是具体数值，先定位最可能的数据报表和筛选口径，再尝试用可用的本地/在线工具读取结果；读不到真实数值时，明确说缺什么，不要把字段来源当成答案。",
    "5. 如果用户问的是“销售的录音链接”这类自然问题，要把“销售”理解为业务场景，而不是只匹配“录音链接”字段。",
    "6. 不要编造；如果只是在本地画像中命中，要说明是基于本地 BI 画像。",
    "输出要求：直接给最推荐的 3-5 张报表，只写报表名、路径、命中字段/同义字段；不要默认输出筛选项、导出状态、画像是否展开、工具流水账。用户只问“哪里有”时，不要解释太多。"
  ].join("\n");
}
