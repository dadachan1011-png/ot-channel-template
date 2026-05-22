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
  { triggers: /PPT|ppt|课件/i, terms: ["PPT", "ppt", "课件", "PPT课件"] },
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
  "有没有",
  "相关",
  "关联"
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

  if (isReportRecommendationQuery(input.query)) {
    return formatReportRecommendation(input.query, reports);
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
    const candidates = findCandidateReports(query, reports).slice(0, 6);
    if (candidates.length > 0) {
      return {
        title: "BI 报表建议",
        text: [
          `没找到完全匹配「${businessLine}」的目录，但可以先看这些可能相关的报表：`,
          "",
          ...candidates.map((match, index) => formatDirectoryCandidate(index + 1, match))
        ].join("\n")
      };
    }

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

function formatReportRecommendation(query: string, reports: ReportEntry[]): SmartBiLookupResult {
  const profile = buildQueryProfile(query);
  const terms = usefulLookupTerms([...profile.searchTerms, ...profile.contextTerms]);
  const matches = rankReportRecommendations(query, reports, terms).slice(0, 12);
  const primary = selectPrimaryRecommendations(matches, terms);
  const subject = recommendationSubject(query, terms);

  if (primary.length === 0) {
    return {
      title: "BI 报表没命中",
      text: `没在本地 BI 画像里找到足够相关的「${subject}」报表。可以补充业务线、指标、字段名或筛选条件再查。`
    };
  }

  const lines = [
    recommendationLeadLine(subject, primary),
    "",
    ...primary.map((match, index) => formatRecommendedReport(index + 1, match))
  ];

  return {
    title: "BI 报表推荐",
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

function rankReportRecommendations(query: string, reports: ReportEntry[], terms: string[]): FieldMatch[] {
  if (terms.length === 0) return [];
  return reports
    .map((report) => {
      const fields = report.fields.filter((field) => scoreText(fieldSearchText(field), terms, query) > 0 && isBusinessFieldName(field.name));
      const filters = report.filters.filter((filter) => scoreText([filter.label, filter.semantic].filter(Boolean).join(" "), terms, query) > 0);
      const reportText = [report.name, ...report.path, report.module ?? "", report.reportType ?? "", ...report.metrics].join(" ");
      const schemaText = [...report.fields.map(fieldSearchText), ...report.filters.map((filter) => filter.label)].join(" ");
      const nameScore = scoreText(report.name, terms, query) * 5;
      const pathScore = scoreText(reportText, terms, query) * 3;
      const fieldScore = fields.reduce((score, field) => score + scoreText(fieldSearchText(field), terms, query), 0) * 2;
      const schemaScore = scoreText(schemaText, terms, query);
      return {
        report,
        fields: fields.slice(0, 8),
        filters: filters.slice(0, 5),
        score: nameScore + pathScore + fieldScore + schemaScore + recommendationSpecificityBonus(report, terms)
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.fields.length - a.fields.length || reportRecommendationPriority(a.report, terms) - reportRecommendationPriority(b.report, terms));
}

function selectPrimaryRecommendations(matches: FieldMatch[], terms: string[]): FieldMatch[] {
  const direct = matches
    .filter((match) => isDirectSubjectReport(match.report, terms))
    .sort((a, b) => reportRecommendationPriority(a.report, terms) - reportRecommendationPriority(b.report, terms) || b.score - a.score);
  const selected = direct.length >= 2 ? direct.slice(0, 2) : matches.slice(0, 3);
  return selected.length > 3 ? selected.slice(0, 3) : selected;
}

function recommendationSubject(query: string, terms: string[]): string {
  const cleaned = cleanTerm(query)
    .replace(/(相关报表|关联报表|报表是哪个|哪个报表|哪些报表|什么报表|报表推荐|是哪个|帮我|查一下|查下|查询|看看|看下|BI|SmartBI)/g, "")
    .trim();
  const term = usefulLookupTerms([cleaned, ...terms]).find((item) => !isQuestionSentence(item));
  return term || "这类数据";
}

function recommendationLeadLine(subject: string, primary: FieldMatch[]): string {
  const directText = primary.length === 2 ? "最直接相关的是这两张：" : "优先看这几张：";
  return `${subject}${directText}`;
}

function recommendationSpecificityBonus(report: ReportEntry, terms: string[]): number {
  let bonus = 0;
  if (/明细|宽表|汇总|达成|趋势|监控/.test(report.name)) bonus += 4;
  if (terms.some((term) => normalizeDisplayText(report.name).toLowerCase().includes(normalizeDisplayText(term).toLowerCase()))) bonus += 6;
  if (terms.some((term) => report.path.some((part) => sameField(part, term)))) bonus += 3;
  return bonus;
}

function formatRecommendedReport(index: number, match: FieldMatch): string {
  const report = match.report;
  return [
    `${index}. ${report.name}`,
    `路径：${report.path.join(" / ") || "-"}`,
    `用途：${purposeForReport(report, match)}`,
    `关键字段：${pickKeyFields(match).join("、") || "-"}`,
    `可筛：${pickFilterLikeFields(report).join("、") || "-"}`
  ].join("\n");
}

function purposeForReport(report: ReportEntry, match?: FieldMatch): string {
  const name = report.name.toLowerCase();
  if (/ppt/.test(name) && /学员|人课/.test(report.name)) return "看 PPT 课件课中到“学员维度”的表现。";
  if (/ppt/.test(name) && /题目/.test(report.name)) return "看 PPT 课件课中到“题目维度”的明细。";
  if (/人课/.test(report.name)) return "看课件到人课/学员维度的表现。";
  if (/课节/.test(report.name)) return "看课件到课节维度的表现。";
  if (/正确率|题目/.test(report.name)) return "看题目或正确率维度的课件表现。";
  if (/宽表/.test(report.name)) return "看更底层、更宽的上课行为明细。";
  const text = [report.name, ...report.path, ...report.fields.map((field) => field.name), ...(match?.fields.map((field) => field.name) ?? [])].join(" ");
  if (/销售|CC|TMK|转化|业绩|渠道|例子|进线|约课/.test(text)) return "看销售过程、转化漏斗或业绩达成相关数据。";
  if (/录音|通话|沟通|语义/.test(text)) return "看沟通过程、录音/通话材料或语义执行明细。";
  if (/续费|退费|升舱/.test(text)) return "看续费、退费、升舱或服务结果相关数据。";
  if (/服务|SOP|LP|学习伙伴/.test(text)) return "看服务动作、LP 跟进或 SOP 执行明细。";
  if (/GMV|流水|收入|消耗|成本|ROI|达成/.test(text)) return "看经营指标、收入成本或目标达成相关数据。";
  const lastPath = report.path.at(-2) && report.path.at(-2) !== report.name ? report.path.at(-2) : report.module;
  return lastPath ? `看「${lastPath}」相关字段或指标。` : "看这类主题下的字段、指标和筛选维度。";
}

function pickKeyFields(match: FieldMatch): string[] {
  const report = match.report;
  const preferred = [
    "上课日期",
    "学员id",
    "学员ID",
    "用户ID",
    "豌豆ID",
    "大账户ID",
    "区域",
    "区域等级",
    "区域细分",
    "CC",
    "TMK",
    "LP",
    "课程阶段",
    "课件名称",
    "教学课件名称",
    "课件ID",
    "课件编号",
    "课件等级",
    "老师id",
    "老师ID",
    "老师名称",
    "益智教学老师",
    "老师团队",
    "渠道一级分类",
    "渠道二级分类",
    "分发类型",
    "通话链接",
    "录音链接",
    "过程id",
    "语义点",
    "执行结果",
    "滚动GMV",
    "GMV",
    "转化率",
    "续费率",
    "解锁题目数",
    "首答正确数",
    "末答正确数",
    "首答正确率",
    "末答正确率"
  ];
  return pickFieldsByPreference(report, preferred, 8, { excludeFilterLike: true });
}

function pickFilterLikeFields(report: ReportEntry): string[] {
  const preferred = [
    "开始日期*",
    "开始日期",
    "结束日期*",
    "结束日期",
    "主讲团队",
    "主讲小组",
    "益智教学老师",
    "班级语种",
    "班级语言",
    "直播间ID",
    "豌豆ID",
    "课件名称",
    "教学课件名称",
    "课程阶段"
  ];
  const fromFilters = report.filters
    .map((filter) => normalizeDisplayText(filter.label))
    .filter((field) => isBusinessFieldName(field) && !sameField(field, report.name))
    .slice(0, 10);
  return [...new Set([...fromFilters, ...pickFieldsByPreference(report, preferred, 8)])].slice(0, 8);
}

function pickFieldsByPreference(report: ReportEntry, preferred: string[], max: number, options: { excludeFilterLike?: boolean } = {}): string[] {
  const filterLabels = report.filters.map((filter) => normalizeDisplayText(filter.label));
  const fields = report.fields
    .map((field) => normalizeDisplayText(field.name))
    .filter((field) => isBusinessFieldName(field) && !sameField(field, report.name))
    .filter((field) => !options.excludeFilterLike || !isFilterLikeFieldName(field));
  const keyFields = options.excludeFilterLike ? fields.filter((field) => !filterLabels.some((filter) => sameField(field, filter))) : fields;
  const picked: string[] = [];
  for (const target of preferred) {
    const found = keyFields.find((field) => sameField(field, target));
    if (found && !picked.includes(found)) picked.push(found);
    if (picked.length >= max) return picked;
  }
  for (const field of keyFields) {
    if (!picked.includes(field)) picked.push(field);
    if (picked.length >= max) break;
  }
  return picked;
}

function sameField(field: string, target: string): boolean {
  const a = normalizeDisplayText(field).replace(/\*/g, "").toLowerCase();
  const b = normalizeDisplayText(target).replace(/\*/g, "").toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
}

function isBusinessFieldName(name: string): boolean {
  const normalized = normalizeDisplayText(name);
  if (!normalized || normalized.length > 40) return false;
  if (/^(刷新|导出|打印|保存|另存为|图形|视图|后退|前进|添加\/删除字段|报表设置|参数设置|耗时分析|个人参数|透视分析|全部显示定制过滤)$/.test(normalized)) return false;
  if (/共行每页|定位数据集|跳转区域|添加\/删除字段|---DOC---|耗时分析|个人参数/.test(normalized)) return false;
  if ((normalized.match(/\*/g) ?? []).length > 1) return false;
  return true;
}

function isFilterLikeFieldName(name: string): boolean {
  return /^(开始日期|结束日期|开始时间|结束时间|日期|月份|月|年|主讲团队|主讲小组|班级语种|班级语言)\*?$/i.test(normalizeDisplayText(name));
}

function isDirectSubjectReport(report: ReportEntry, terms: string[]): boolean {
  const text = pathText(report).toLowerCase();
  const usefulTerms = terms.map((term) => normalizeDisplayText(term).toLowerCase()).filter((term) => term.length >= 2);
  if (usefulTerms.length === 0) return false;
  const hitCount = usefulTerms.filter((term) => text.includes(term)).length;
  return hitCount >= Math.min(2, usefulTerms.length) || usefulTerms.some((term) => normalizeDisplayText(report.name).toLowerCase().includes(term));
}

function reportRecommendationPriority(report: ReportEntry, terms: string[] = []): number {
  if (report.name === "海外教学ppt课件课中学员明细") return 0;
  if (report.name === "海外教学ppt课件课中题目明细") return 1;
  const name = normalizeDisplayText(report.name).toLowerCase();
  const directTermHits = terms.filter((term) => name.includes(normalizeDisplayText(term).toLowerCase())).length;
  let priority = 20 - directTermHits * 3;
  if (/明细|宽表/.test(report.name)) priority -= 3;
  if (/汇总|达成|趋势|监控/.test(report.name)) priority -= 2;
  if (/验收中|旧版|旧节点/.test(report.name)) priority += 4;
  return priority;
}

function isCoursewareReport(report: ReportEntry): boolean {
  return /课件|ppt/i.test([report.name, ...report.path, ...report.fields.map((field) => field.name)].join(" "));
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
  if (fieldSynonyms.some(([term, synonyms]) => [term, ...synonyms].some((item) => compact.includes(item)))) return true;
  return /(字段|指标|口径|取数|来源|链接|从.*报表|哪个报表|什么报表|哪些报表|哪里看|哪里查|可以在.*报表|field|metric|column)/i.test(compact);
}

function isReportRecommendationQuery(query: string): boolean {
  const compact = query.replace(/\s+/g, "");
  if (!/(报表|BI|SmartBI)/i.test(compact)) return false;
  if (knownMetricTerms.some((term) => compact.toLowerCase().includes(term.toLowerCase()))) return false;
  if (/(字段|指标|口径|来源|取数|看到|能看|能查)/.test(compact)) return false;
  return /(相关报表|关联报表|报表是哪个|哪个报表|哪些报表|什么报表|报表推荐|找.*报表|查.*报表)/i.test(compact);
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
    .replace(/(?:字段|指标|口径|来源|报表|取数|哪里|哪个|哪些|什么|相关|关联|有关|对应|来自|从|可以|看到|是|的)+$/g, "")
    .replace(/^BI/i, "");
  const pieces = term.split(/(?:字段|指标|口径|来源|报表|取数|哪里|哪个|哪些|什么|相关|关联|有关|对应|帮我|查询|查|看下|看一下|看|定位|来自|获取|从|可以|看到|是|的)+/).filter(Boolean);
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
  const terms = usefulLookupTerms([businessLine, ...extractQueryTerms(query)]);
  const primary =
    businessLine && !isGenericBiTerm(businessLine) ? reports.filter((report) => pathText(report).includes(businessLine)) : [];
  if (primary.length > 0) return primary;
  return reports.filter((report) => terms.some((term) => pathText(report).includes(term)));
}

function findCandidateReports(query: string, reports: ReportEntry[]): FieldMatch[] {
  const profile = buildQueryProfile(query);
  const terms = usefulLookupTerms([...profile.searchTerms, ...profile.contextTerms]);
  if (terms.length === 0) return [];
  return reports
    .map((report) => {
      const fields = report.fields.filter((field) => scoreText(fieldSearchText(field), terms, query) > 0);
      const filters = report.filters.filter((filter) => scoreText([filter.label, filter.semantic].filter(Boolean).join(" "), terms, query) > 0);
      const reportText = [pathText(report), ...report.metrics, ...report.fields.map(fieldSearchText)].join(" ");
      return {
        report,
        fields: fields.slice(0, 8),
        filters: filters.slice(0, 5),
        score: scoreText(reportText, terms, query)
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.fields.length - a.fields.length);
}

function formatDirectoryCandidate(index: number, match: FieldMatch): string {
  const fields = [...new Set(match.fields.map((field) => normalizeDisplayText(field.name)))].slice(0, 6);
  return [
    `${index}. ${match.report.name}`,
    `   路径：${match.report.path.join(" / ") || "-"}`,
    ...(fields.length ? [`   相关字段：${fields.join("、")}`] : [])
  ].join("\n");
}

function usefulLookupTerms(terms: string[]): string[] {
  return [...new Set(terms.map(cleanTerm).filter((term) => isUsefulTerm(term) && !isGenericBiTerm(term)))];
}

function isGenericBiTerm(term: string): boolean {
  return /^(BI|SmartBI|报表|数据|画像|目录|相关报表)$/i.test(term.trim());
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
  if (match?.[1]) return match[1];
  return usefulLookupTerms(extractQueryTerms(query))[0] ?? "相关报表";
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
