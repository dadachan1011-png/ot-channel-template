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
});
