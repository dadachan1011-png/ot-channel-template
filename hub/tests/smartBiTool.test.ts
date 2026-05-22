import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { executeSmartBiReportLookup } from "../src/tools/smartBiTool.js";

process.env.BI_KNOWLEDGE_FILES = join(process.cwd(), "tests", "fixtures", "bi_report_knowledge.json");

describe("executeSmartBiReportLookup", () => {
  it("locates BI field sources from a natural field question", async () => {
    const result = await executeSmartBiReportLookup({ query: "滚动GMV可以在什么报表看到" });

    expect(result.title).toBe("BI 字段来源");
    expect(result.text).toContain("滚动GMV");
    expect(result.text).toContain("路径：");
    expect(result.text).toContain("命中字段：");
  });

  it("keeps concise output for field lookup", async () => {
    const result = await executeSmartBiReportLookup({ query: "什么报表可以看到销售的录音链接" });

    expect(result.title).toBe("BI 字段来源");
    expect(result.text).toContain("益智CC沟通明细");
    expect(result.text).toContain("通话链接");
    expect(result.text).not.toContain("通时通次明细");
    expect(result.text).not.toContain("参考字段：TMK_ID");
    expect(result.text).not.toContain("字段名未在画像中展开");
    expect(result.text).not.toContain("筛选项");
    expect(result.text).not.toContain("导出：");
  });

  it("routes a bare metric name as a BI field lookup", async () => {
    const result = await executeSmartBiReportLookup({ query: "滚动GMV" });

    expect(result.title).toBe("BI 字段来源");
    expect(result.text).toContain("滚动GMV");
    expect(result.text).not.toContain("泛泛");
  });

  it("keeps report directory lookup working", async () => {
    const result = await executeSmartBiReportLookup({ query: "帮我看下 BI 海外业务线报表目录" });

    expect(result.title).toBe("BI 报表目录");
    expect(result.text).toContain("一级目录");
    expect(result.text).toContain("海外");
  });

  it("answers PPT courseware report questions with ranked concrete reports", async () => {
    const result = await executeSmartBiReportLookup({ query: "ppt课件相关报表是哪个" });

    expect(result.title).toBe("BI 报表推荐");
    expect(result.text).toContain("ppt课件最直接相关的是这两张");
    expect(result.text).toContain("海外教学ppt课件课中学员明细");
    expect(result.text).toContain("海外教学ppt课件课中题目明细");
    expect(result.text.indexOf("海外教学ppt课件课中学员明细")).toBeLessThan(result.text.indexOf("海外教学ppt课件课中题目明细"));
    expect(result.text).toContain("路径：海外直播业务线 / 海外学科 / 正课 / 上课&行为数据");
    expect(result.text).toContain("用途：看 PPT 课件课中到“学员维度”的表现。");
    expect(result.text).toContain("用途：看 PPT 课件课中到“题目维度”的明细。");
    expect(result.text).toContain("关键字段：");
    expect(result.text).toContain("可筛：");
    expect(result.text).not.toContain("也可以顺手参考");
    expect(result.text).not.toContain("Demo课繁体课件占比及转化");
    expect(result.text).not.toContain("新加坡课件&老师到课转化情况");
    expect(result.text).not.toContain("Demo课分课件不同时段满班率");
    expect(result.text).not.toContain("有销售过程、转化漏斗或业绩达成相关数据");
    expect(result.text).not.toContain("关键字段：课件名称、上课日期、开始日期*");
    expect(result.text).not.toMatch(/关键字段：.*开始日期\*/);
    expect(result.text).not.toMatch(/关键字段：.*结束日期\*/);
    expect(result.text).not.toMatch(/关键字段：.*主讲小组/);
    expect(result.text).not.toContain("一级目录");
    expect(result.text).not.toContain("共行每页");
    expect(result.text).not.toContain("定位数据集");
    expect(result.text).not.toContain("开始日期*结束日期*");
    expect(result.text).not.toContain("关键字段：豌豆ID、海外教学ppt课件课中题目明细");
    expect(result.text).not.toContain("可筛：开始日期*、结束日期*、直播间ID、豌豆ID、海外教学ppt课件课中题目明细");
    expect(result.text).not.toContain("继续展开 BI 目录");
    expect(result.text).not.toContain("继续检查 BI 元数据缺口");
  });

  it("answers non-PPT report recommendation questions without courseware copy", async () => {
    const result = await executeSmartBiReportLookup({ query: "销售相关报表是哪个" });

    expect(result.title).toBe("BI 报表推荐");
    expect(result.text).toContain("销售");
    expect(result.text).toContain("路径：");
    expect(result.text).toContain("用途：");
    expect(result.text).toContain("关键字段：");
    expect(result.text).toContain("可筛：");
    expect(result.text).not.toContain("课件相关字段");
    expect(result.text).not.toContain("PPT 课中互动题表现");
    expect(result.text).not.toContain("一级目录");
    expect(result.text).not.toContain("继续展开 BI 目录");
  });

  it("keeps field-like report questions on field lookup instead of broad recommendation", async () => {
    const result = await executeSmartBiReportLookup({ query: "录音链接相关报表是哪个" });

    expect(result.title).toBe("BI 字段来源");
    expect(result.text).toContain("录音链接");
    expect(result.text).not.toContain("BI 报表推荐");
    expect(result.text).not.toContain("PPT 课中互动题表现");
  });
});
