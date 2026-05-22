import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export type SmartBiLookupResult = {
  title: string;
  text: string;
};

type FieldEntry = {
  name: string;
  role?: string;
  semantic?: string;
  businessMeaning?: string;
};

type FilterEntry = {
  label: string;
  semantic?: string;
};

type ReportEntry = {
  name: string;
  path: string[];
  module?: string;
  exportStatus?: string;
  reportType?: string;
  source: string;
  fields: FieldEntry[];
  filters: FilterEntry[];
  metrics: string[];
};

type FieldMatch = {
  report: ReportEntry;
  fields: FieldEntry[];
  filters: FilterEntry[];
  score: number;
};

type QueryProfile = {
  searchTerms: string[];
  fieldTerms: string[];
  contextTerms: string[];
};

function knownDataFiles(): string[] {
  const configured = process.env.BI_KNOWLEDGE_FILES;
  if (configured) {
    return configured
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [
    "memory/kb/bi/report_knowledge.json",
    "memory/kb/bi/kb_bi_business_data_map.json",
    "memory/kb/bi/report_profiles_v2.json"
  ];
}

const knownMetricTerms = [
  "滚动GMV",
  "GMV-MTD达成率",
  "GMV达成率",
  "GMV目标",
  "GMV",
  "约课数",
  "到课率",
  "约课率",
  "转化率",
  "续费率",
  "退费率",
  "例子数",
  "例子成本",
  "例子转化",
  "ROI2",
  "ROI",
  "消耗",
  "成本",
  "流水",
  "达成率",
  "目标",
  "ASP",
  "出勤",
  "完课",
  "续费",
  "退费"
];

const fieldSynonyms: Array<[string, string[]]> = [
  ["录音链接", ["通话链接"]],
  ["通话链接", ["录音链接"]]
];

const businessSemanticExpansions: Array<{ triggers: RegExp; terms: string[] }> = [
  { triggers: /销售|售前|CC|cc/i, terms: ["销售", "CC", "沟通", "通话", "海外前端", "TMK", "业绩"] },
  { triggers: /TMK|tmk/i, terms: ["TMK", "海外前端", "业务明细", "语义分析"] },
  { triggers: /服务|SOP|sop/i, terms: ["服务", "SOP", "海外后端", "语义分析"] },
  { triggers: /转介绍/, terms: ["转介绍", "海外后端", "语义分析"] },
  { triggers: /退费|续费/, terms: ["退费", "续费", "语义分析"] },
  { triggers: /LP|lp|学习伙伴/i, terms: ["LP", "学习伙伴", "小组"] }
];

const stopTerms = new Set([
  "BI",
  "SmartBI",
  "字段",
  "指标",
  "口径",
  "报表",
  "数据",
  "来源",
  "获取",
  "哪里",
  "哪个",
  "哪些",
  "什么",
  "怎么",
  "查看",
  "查询",
  "帮我",
  "看下",
  "看一下",
  "定位",
  "来自",
  "取数",
  "可以",
  "看到",
  "能看",
  "能查",
  "有没有"
]);

export async function executeSmartBiReportLookup(input: { query: string }): Promise<SmartBiLookupResult> {
  const reports = dedupeReports((await Promise.all(knownDataFiles().map(loadReportsFromFile))).flat());
  if (reports.length === 0) {
    return {
      title: "BI 查询没跑通",
      text: "我没找到可读的 BI 报表元数据。请先配置 `BI_KNOWLEDGE_FILES`，或把索引文件放到 `memory/kb/bi/`。"
    };
  }

  if (isFieldLookupQuery(input.query)) {
    return formatFieldLookup(input.query, reports);
  }

  return formatDirectoryLookup(input.query, reports);
}

export function isSmartBiLookupPrompt(prompt: string): boolean {
  return /smartbi_report_lookup|SmartBI 报表目录|BI\/SmartBI|BI 字段来源|字段.*报表|报表目录与字段来源查询/i.test(prompt);
}

async function loadReportsFromFile(path: string): Promise<ReportEntry[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== "object") return [];
  const object = data as Record<string, unknown>;
  if (object.reports && typeof object.reports === "object") return loadReportsFromProfiles(object.reports, path);
  if (Array.isArray(object.modules)) return loadReportsFromKnowledgeMap(object, path);
  return [];
}

function loadReportsFromKnowledgeMap(data: Record<string, unknown>, source: string): ReportEntry[] {
  const output: ReportEntry[] = [];
  for (const module of asArray<Record<string, unknown>>(data.modules)) {
    const moduleTitle = asString(module.title);
    const moduleMetrics = asStringArray(module.metrics);
    for (const report of asArray<Record<string, unknown>>(module.reports)) {
      const name = asString(report.name);
      const path = normalizePath(report.path_text ?? report.path);
      const fields = fieldsFromUnknown(report.sample_columns);
      const metrics = [...new Set([...moduleMetrics, ...fields.filter((field) => field.role === "metric_candidate").map((field) => field.name)])];
      if (!name && path.length === 0) continue;
      output.push({
        name: name || path.at(-1) || "未命名报表",
        path,
        module: moduleTitle,
        exportStatus: asString(report.export_status),
        reportType: asString(report.report_type),
        source: shortSource(source),
        fields,
        filters: filtersFromUnknown(report.filters),
        metrics
      });
    }
  }
  return output;
}

function loadReportsFromProfiles(reports: unknown, source: string): ReportEntry[] {
  const values = Array.isArray(reports) ? reports : Object.values(reports as Record<string, unknown>);
  return values
    .map((item) => {
      const report = item as Record<string, unknown>;
      const identity = (report.identity ?? {}) as Record<string, unknown>;
      const exportInfo = (report.export ?? {}) as Record<string, unknown>;
      const schema = (report.schema ?? {}) as Record<string, unknown>;
      const path = normalizePath(identity.path ?? identity.path_text);
      const name = asString(report.name) || asString(identity.name) || path.at(-1) || "未命名报表";
      return {
        name,
        path,
        module: asString(report.module),
        exportStatus: asString(exportInfo.last_status),
        reportType: asString(identity.report_type ?? identity.type),
        source: shortSource(source),
        fields: fieldsFromUnknown(schema.fields ?? schema.columns),
        filters: filtersFromUnknown(report.filters),
        metrics: asStringArray((report.business_mapping as Record<string, unknown> | undefined)?.metrics ?? report.metrics)
      };
    })
    .filter((item) => item.name || item.path.length > 0);
}

function formatFieldLookup(query: string, reports: ReportEntry[]): SmartBiLookupResult {
  const profile = buildQueryProfile(query);
  const terms = profile.searchTerms;
  const matches = reports
    .map((report) => scoreFieldMatch(report, profile, query))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.fields.length - a.fields.length)
    .slice(0, 6);

  if (matches.length === 0) {
    return {
      title: "BI 字段没命中",
      text: [
        `我读到了 ${reports.length} 张 BI 报表画像，但没匹配到「${terms.join("、") || query}」对应字段。`,
        "可以换成更贴近报表里的字段名，比如“滚动GMV / 约课数 / 到课率 / user_id / demo_order_id”。"
      ].join("\n")
    };
  }

  return {
    title: "BI 字段来源",
    text: [`查到了，优先看这几张：`, "", ...matches.map((match, index) => formatFieldMatch(index + 1, match))].join("\n")
  };
}

function formatDirectoryLookup(query: string, reports: ReportEntry[]): SmartBiLookupResult {
  const businessLine = inferBusinessLine(query);
  const matched = filterReports(reports, businessLine, query);
  if (matched.length === 0) {
    return {
      title: "BI 查询没查到",
      text: `没在本地 BI 画像里匹配到「${businessLine}」相关报表。已读取 ${reports.length} 条报表画像。`
    };
  }

  const tree = summarizeDirectoryTree(matched);
  const topModules = summarizeModules(matched);
  const sourceNames = [...new Set(matched.map((item) => item.source))].slice(0, 2);
  const lines = [
    `查到了，「${businessLine}」相关本地 BI 画像里有 ${matched.length} 张报表。`,
    "",
    "一级目录：",
    ...tree.slice(0, 10).map((item) => `- ${item.name}：${item.count} 张${item.children.length ? `，含 ${item.children.slice(0, 5).join("、")}` : ""}`),
    ...(topModules.length ? ["", "主要业务模块：", ...topModules.slice(0, 5).map((item) => `- ${item.name}：${item.count} 张`)] : []),
    "",
    `数据来源：${sourceNames.join(" / ")}`
  ];

  if (tree.length > 10) lines.splice(12, 0, `- 还有 ${tree.length - 10} 个一级目录未展开`);

  return {
    title: "BI 报表目录",
    text: lines.join("\n")
  };
}

function scoreFieldMatch(report: ReportEntry, profile: QueryProfile, query: string): FieldMatch {
  const terms = profile.searchTerms;
  const fieldTerms = profile.fieldTerms.length ? profile.fieldTerms : terms;
  const fieldMatches = report.fields.filter((field) => scoreText(fieldSearchText(field), fieldTerms, query) > 0);
  const filterMatches = report.filters.filter((filter) => scoreText([filter.label, filter.semantic].filter(Boolean).join(" "), terms, query) > 0);
  const metricScore = report.metrics.reduce((score, metric) => score + scoreText(metric, fieldTerms, query), 0);
  const fieldScore = fieldMatches.reduce((score, field) => score + scoreText(fieldSearchText(field), fieldTerms, query), 0);
  const filterScore = filterMatches.reduce((score, filter) => score + scoreText([filter.label, filter.semantic].filter(Boolean).join(" "), terms, query), 0);
  const pathScore = scoreText(pathText(report), terms, query);
  const contextScore = scoreContextMatch(report, profile.contextTerms, query);
  const fieldIntentWithoutFieldEvidence = profile.fieldTerms.length > 0 && fieldScore === 0 && metricScore === 0;
  return {
    report,
    fields: fieldMatches.slice(0, 8),
    filters: filterMatches.slice(0, 5),
    score: fieldIntentWithoutFieldEvidence ? 0 : fieldScore * 4 + filterScore * 2 + metricScore * 3 + pathScore + contextScore
  };
}

function formatFieldMatch(index: number, match: FieldMatch): string {
  const report = match.report;
  const matchedFields = [...new Set(match.fields.map((field) => normalizeDisplayText(field.name)))].slice(0, 6);
  const referenceFields = matchedFields.length ? [] : pickReferenceFields(report);
  const fieldLine = matchedFields.length
    ? `   命中字段：${matchedFields.join("、")}`
    : referenceFields.length
      ? `   参考字段：${referenceFields.join("、")}`
      : undefined;
  return [`${index}. ${report.name}`, `   路径：${report.path.join(" / ") || "-"}`, ...(fieldLine ? [fieldLine] : [])].join("\n");
}

function pickReferenceFields(report: ReportEntry): string[] {
  const fields = report.fields
    .map((field) => normalizeDisplayText(field.name))
    .filter((name) => name && !/^(刷新|导出|打印|后退|前进|保存|另存为|图形|视图|个人参数|耗时分析)$/.test(name));
  const preferred = fields.filter((name) => /(链接|通话|录音|沟通|日期|时间|用户|学员|ID|CC|TMK|LP|小组|类型|结果|状态|GMV|流水|金额|数|率)/i.test(name));
  return [...new Set(preferred.length ? preferred : fields)].slice(0, 6);
}

function isFieldLookupQuery(query: string): boolean {
  const compact = query.replace(/\s+/g, "");
  if (knownMetricTerms.some((term) => compact.toLowerCase().includes(term.toLowerCase()))) return true;
  return /(字段|指标|口径|取数|来源|从.*报表|哪个报表|什么报表|哪些报表|哪里看|哪里查|可以在.*报表|field|metric|column)/i.test(compact);
}

function extractQueryTerms(query: string): string[] {
  return buildQueryProfile(query).searchTerms;
}

function buildQueryProfile(query: string): QueryProfile {
  const terms: string[] = [];
  const fieldTerms: string[] = [];
  const compact = query.replace(/\s+/g, "");
  for (const term of knownMetricTerms) {
    if (compact.toLowerCase().includes(term.toLowerCase())) fieldTerms.push(term);
  }
  for (const [term, synonyms] of fieldSynonyms) {
    if (compact.includes(term)) fieldTerms.push(term, ...synonyms);
  }
  const contextTerms = extractBusinessContextTerms(compact);
  terms.push(...fieldTerms, ...contextTerms);

  const quoted = [...query.matchAll(/[“"'「『]([^”"'」』]{2,40})[”"'」』]/g)].map((match) => match[1]);
  terms.push(...quoted);

  const patterns = [
    /(.+?)可以在(?:什么|哪个|哪些)?报表(?:看到|看|查到|查询)?/,
    /(.+?)(?:能在|在哪个|在什么|在哪些|从哪个|从什么|从哪些)报表(?:看到|看|查到|查询|取)?/,
    /(.+?)(?:字段|指标|口径)?(?:从|在)(?:哪个|什么|哪些)?报表/,
    /(.+?)(?:字段|指标|口径|取数|来源)/
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match?.[1]) terms.push(cleanTerm(match[1]));
  }

  const words = query.match(/[\u4e00-\u9fa5A-Za-z0-9_]+/g) ?? [];
  const splitChinese = words.flatMap((word) => splitCompoundTerm(word));
  terms.push(...words, ...splitChinese);

  const useful = [...new Set(terms.map(cleanTerm).filter(isUsefulTerm))];
  const knownHits = useful.filter((term) => knownMetricTerms.some((known) => known.toLowerCase() === term.toLowerCase()));
  const finalTerms = knownHits.length ? [...knownHits, ...useful.filter((term) => !isQuestionSentence(term) && !knownHits.includes(term))] : useful;
  return {
    searchTerms: finalTerms.slice(0, 16),
    fieldTerms: [...new Set(fieldTerms.map(cleanTerm).filter(isUsefulTerm))],
    contextTerms: [...new Set(contextTerms.map(cleanTerm).filter(isUsefulTerm))]
  };
}

function extractBusinessContextTerms(compactQuery: string): string[] {
  return businessSemanticExpansions.flatMap((expansion) => (expansion.triggers.test(compactQuery) ? expansion.terms : []));
}

function scoreContextMatch(report: ReportEntry, contextTerms: string[], query: string): number {
  if (contextTerms.length === 0) return 0;
  const reportContextText = [
    report.name,
    ...report.path,
    report.module ?? "",
    report.reportType ?? "",
    ...report.filters.map((filter) => filter.label)
  ].join(" ");
  return scoreText(reportContextText, contextTerms, query) * 3;
}

function splitCompoundTerm(term: string): string[] {
  const cleaned = cleanTerm(term)
    .replace(/^(?:帮我|请|麻烦你|查|查询|查看|看|看下|看一下|定位|找|获取)+/g, "")
    .replace(/(?:字段|指标|口径|来源|报表|取数|哪里|哪个|哪些|什么|来自|从|可以|看到|的)+$/g, "")
    .replace(/^BI/i, "");
  const pieces = term.split(/(?:字段|指标|口径|来源|报表|取数|哪里|哪个|哪些|什么|帮我|查询|查|看下|看一下|看|定位|来自|获取|从|可以|看到|的)+/).filter(Boolean);
  if (cleaned && cleaned !== term) pieces.push(cleaned);
  if (/^[A-Za-z0-9_]+$/.test(term)) return pieces;
  return pieces.filter((item) => item.length >= 2);
}

function cleanTerm(term: string): string {
  return term
    .replace(/^[@\s，,。？?！!：:；;、]+|[@\s，,。？?！!：:；;、]+$/g, "")
    .replace(/^(?:帮我|请|麻烦你|查一下|查下|查|查询|查看|看下|看一下|看|定位|找一下|找|BI|SmartBI)+/i, "")
    .trim();
}

function isUsefulTerm(term: string): boolean {
  if (term.length < 2) return false;
  if (stopTerms.has(term)) return false;
  if (/^(一个|这个|那个|一下|可以|需要|应该|是否|我要|我想知道)$/.test(term)) return false;
  if (isQuestionSentence(term) && !knownMetricTerms.some((known) => term.includes(known))) return false;
  return true;
}

function isQuestionSentence(term: string): boolean {
  return /(可以在|什么报表|哪个报表|哪些报表|哪里|看到|查询|查看|取数|来源)/.test(term);
}

function scoreText(text: string, terms: string[], query: string): number {
  const normalized = normalizeDisplayText(text).toLowerCase();
  let score = 0;
  for (const term of terms) {
    const lower = normalizeDisplayText(term).toLowerCase();
    if (!lower) continue;
    if (normalized === lower) score += 12;
    else if (normalized.includes(lower)) score += Math.min(8, Math.max(2, lower.length));
    else if (lower.includes(normalized) && normalized.length >= 2) score += 3;
  }
  const compactQuery = normalizeDisplayText(query).toLowerCase();
  if (normalized && compactQuery.includes(normalized) && normalized.length >= 2) score += 5;
  return score;
}

function fieldSearchText(field: FieldEntry): string {
  return [field.name, field.role, field.semantic, field.businessMeaning].filter(Boolean).join(" ");
}

function filterReports(reports: ReportEntry[], businessLine: string, query: string): ReportEntry[] {
  const terms = [...new Set([businessLine, ...extractQueryTerms(query)])];
  const primary = reports.filter((report) => pathText(report).includes(businessLine));
  if (primary.length > 0) return primary;
  return reports.filter((report) => terms.some((term) => pathText(report).includes(term)));
}

function summarizeDirectoryTree(reports: ReportEntry[]): Array<{ name: string; count: number; children: string[] }> {
  const rootIndex = inferCommonRootIndex(reports);
  const buckets = new Map<string, Map<string, number>>();
  for (const report of reports) {
    const level = report.path[rootIndex + 1] ?? report.path[rootIndex] ?? "未分组";
    const child = report.path[rootIndex + 2] ?? "";
    if (!buckets.has(level)) buckets.set(level, new Map());
    if (child) buckets.get(level)?.set(child, (buckets.get(level)?.get(child) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([name, children]) => ({
      name,
      count: reports.filter((report) => (report.path[rootIndex + 1] ?? report.path[rootIndex] ?? "未分组") === name).length,
      children: [...children.entries()].sort((a, b) => b[1] - a[1]).map(([child]) => child)
    }))
    .sort((a, b) => b.count - a.count);
}

function summarizeModules(reports: ReportEntry[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const report of reports) {
    if (!report.module) continue;
    counts.set(report.module, (counts.get(report.module) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function inferCommonRootIndex(reports: ReportEntry[]): number {
  const counts = new Map<number, number>();
  for (const report of reports) {
    const index = report.path.findIndex((part) => /海外|直播业务线|业务线/.test(part));
    if (index >= 0) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function inferBusinessLine(query: string): string {
  if (/海外直播业务线/.test(query)) return "海外直播业务线";
  if (/海外业务线|海外/.test(query)) return "海外";
  const match = query.match(/([\u4e00-\u9fa5A-Za-z0-9]+业务线)/);
  return match?.[1] ?? "BI";
}

function dedupeReports(reports: ReportEntry[]): ReportEntry[] {
  const seen = new Set<string>();
  const output: ReportEntry[] = [];
  for (const report of reports) {
    const key = `${report.name}\n${report.path.join("/")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(report);
  }
  return output;
}

function normalizePath(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(asString).filter(Boolean);
  const text = asString(input);
  if (!text) return [];
  return text.split(/\s*[/\\>＞]\s*/).map((item) => item.trim()).filter(Boolean);
}

function pathText(report: ReportEntry): string {
  return [report.name, ...report.path, report.module ?? "", report.reportType ?? ""].join(" ");
}

function fieldsFromUnknown(input: unknown): FieldEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map<FieldEntry | undefined>((item) => {
      if (typeof item === "string") return { name: item, role: inferFieldRole(item) };
      if (!item || typeof item !== "object") return undefined;
      const object = item as Record<string, unknown>;
      const name = asString(object.name) || asString(object.normalized_name) || asString(object.label);
      if (!name) return undefined;
      return {
        name: normalizeDisplayText(name),
        role: asString(object.role) || inferFieldRole(name),
        semantic: asString(object.semantic),
        businessMeaning: asString(object.business_meaning)
      };
    })
    .filter((item): item is FieldEntry => Boolean(item));
}

function filtersFromUnknown(input: unknown): FilterEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === "string") return { label: item };
      if (!item || typeof item !== "object") return undefined;
      const object = item as Record<string, unknown>;
      const label = asString(object.label) || asString(object.name) || asString(object.filter);
      if (!label) return undefined;
      return { label: normalizeDisplayText(label), semantic: asString(object.semantic) };
    })
    .filter((item): item is FilterEntry => Boolean(item));
}

function inferFieldRole(name: string): string {
  return /(率|数|GMV|ROI|金额|成本|消耗|预算|目标|达成|占比|ASP|收入|退费|流水)/i.test(name) ? "metric_candidate" : "dimension_candidate";
}

function shortSource(path: string): string {
  return path.split(/[\\/]/).slice(-3).join("\\");
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeDisplayText(input: string): string {
  return input.replace(/\s+/g, "").trim();
}

function asStringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.map(asString).filter(Boolean) : [];
}

function asArray<T>(input: unknown): T[] {
  return Array.isArray(input) ? (input as T[]) : [];
}
