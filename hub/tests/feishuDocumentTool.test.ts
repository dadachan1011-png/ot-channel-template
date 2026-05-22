import { describe, expect, it } from "vitest";
import { executeFeishuDocumentAnalysis } from "../src/tools/feishuDocumentTool.js";

describe("executeFeishuDocumentAnalysis", () => {
  it("explains missing Feishu app credentials", async () => {
    const result = await executeFeishuDocumentAnalysis(
      { query: "https://my.feishu.cn/wiki/NnCIwh6gjiBp9CkrlVWcx4sfn88 去看下这个链接的内容，有什么问题" },
      {}
    );

    expect(result.title).toBe("飞书文档没读到");
    expect(result.text).toContain("FEISHU_READ_COMMAND");
    expect(result.text).toContain("FEISHU_APP_ID");
    expect(result.text).toContain("FEISHU_APP_SECRET");
  });

  it("prefers configured Feishu CLI output before API credentials", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith("/responses")) {
        expect(String(init?.body)).toContain("CLI 读到的正文");
        return json({ output_text: "CLI 正文已分析：缺少验收标准。" });
      }
      throw new Error(`unexpected url ${target}`);
    };

    const result = await executeFeishuDocumentAnalysis(
      { query: "https://my.feishu.cn/wiki/NnCIwh6gjiBp9CkrlVWcx4sfn88 去看下这个链接的内容，有什么问题" },
      {
        readCommand: [process.execPath, "-e", "console.log(JSON.stringify({content:'CLI 读到的正文：没有验收标准'}))"],
        openAiApiKey: "key",
        openAiBaseUrl: "https://gateway.example.com/v1",
        openAiModel: "gpt-5.5",
        fetcher
      }
    );

    expect(calls).toEqual(["https://gateway.example.com/v1/responses"]);
    expect(result.title).toBe("飞书文档分析");
    expect(result.text).toContain("CLI 正文已分析");
  });

  it("parses lark-cli docs fetch output with prelude text and data.markdown", async () => {
    const fetcher: typeof fetch = async (url, init) => {
      const target = String(url);
      if (target.endsWith("/responses")) {
        expect(String(init?.body)).toContain("lark cli markdown body");
        return json({ output_text: "analysis from lark cli markdown" });
      }
      throw new Error(`unexpected url ${target}`);
    };

    const script = [
      "console.log('[deprecated] docs +fetch is using the v1 API.');",
      "console.log(JSON.stringify({ok:true,data:{title:'doc title',markdown:'lark cli markdown body'}}));"
    ].join("");

    const result = await executeFeishuDocumentAnalysis(
      { query: "https://my.feishu.cn/wiki/NnCIwh6gjiBp9CkrlVWcx4sfn88 analyze this" },
      {
        readCommand: [process.execPath, "-e", script],
        openAiApiKey: "key",
        openAiBaseUrl: "https://gateway.example.com/v1",
        openAiModel: "gpt-5.5",
        fetcher
      }
    );

    expect(result.title).toBe("飞书文档分析");
    expect(result.text).toBe("analysis from lark cli markdown");
  });

  it("reads Feishu wiki docx content and sends it to the LLM for analysis", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith("/auth/v3/tenant_access_token/internal")) {
        return json({ code: 0, data: { tenant_access_token: "tenant_token" } });
      }
      if (target.includes("/wiki/v2/spaces/get_node")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer tenant_token" });
        return json({ code: 0, data: { node: { obj_type: "docx", obj_token: "docx_token" } } });
      }
      if (target.includes("/docx/v1/documents/docx_token/raw_content")) {
        return json({ code: 0, data: { content: "目标：提升线索转化\n问题：没有定义成功指标\n动作：下周启动" } });
      }
      if (target.endsWith("/responses")) {
        expect(String(init?.body)).toContain("没有定义成功指标");
        return json({ output_text: "逻辑基本成立，但成功指标缺失。\n1. 目标有了，衡量口径没写。\n建议：补转化率和负责人。" });
      }
      throw new Error(`unexpected url ${target}`);
    };

    const result = await executeFeishuDocumentAnalysis(
      { query: "https://my.feishu.cn/wiki/NnCIwh6gjiBp9CkrlVWcx4sfn88 去看下这个链接的内容，有什么问题" },
      {
        appId: "app_id",
        appSecret: "app_secret",
        openAiApiKey: "key",
        openAiBaseUrl: "https://gateway.example.com/v1",
        openAiModel: "gpt-5.5",
        fetcher
      }
    );

    expect(calls).toEqual([
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=NnCIwh6gjiBp9CkrlVWcx4sfn88",
      "https://open.feishu.cn/open-apis/docx/v1/documents/docx_token/raw_content",
      "https://gateway.example.com/v1/responses"
    ]);
    expect(result.title).toBe("飞书文档分析");
    expect(result.text).toContain("成功指标缺失");
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
