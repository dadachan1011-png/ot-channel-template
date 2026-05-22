import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FeishuDocumentAnalysisOptions = {
  readCommand?: string[];
  appId?: string;
  appSecret?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  openAiTimeoutMs?: number;
  openAiMaxRetries?: number;
  openAiUserAgent?: string;
  openAiExtraHeaders?: Record<string, string>;
  fetcher?: typeof fetch;
};

export type FeishuDocumentAnalysisResult = {
  title: string;
  text: string;
};

type FeishuApiResult = {
  code?: number;
  msg?: string;
  data?: unknown;
};

export function isFeishuDocumentReviewPrompt(prompt: string): boolean {
  return /feishu_document_read_analyze|飞书文档\/知识库链接|my\.feishu\.cn\/wiki/i.test(prompt);
}

export async function executeFeishuDocumentAnalysis(
  input: { query: string },
  options: FeishuDocumentAnalysisOptions
): Promise<FeishuDocumentAnalysisResult> {
  const urls = extractUrls(input.query);
  const wikiUrl = urls.find((url) => /(?:^|\.)feishu\.cn$/i.test(url.hostname) && /^\/wiki\//i.test(url.pathname));
  if (!wikiUrl) {
    return {
      title: "飞书文档没读到",
      text: "我没在这条消息里识别到飞书 wiki 链接。"
    };
  }

  const wikiToken = extractWikiToken(wikiUrl);
  let cliError: Error | undefined;
  if (options.readCommand?.length) {
    try {
      const content = await readContentWithCommand({
        command: options.readCommand,
        url: wikiUrl.toString(),
        wikiToken,
        timeoutMs: options.openAiTimeoutMs ?? 60000
      });
      if (content.trim()) {
        return {
          title: "飞书文档分析",
          text: await analyzeDocumentContent(input.query, content, options)
        };
      }
      cliError = new Error("飞书 CLI 读取成功但输出为空");
    } catch (error) {
      cliError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!options.appId || !options.appSecret) {
    return {
      title: "飞书文档没读到",
      text: [
        cliError ? `飞书 CLI 读取失败：${cliError.message}` : "还没有配置飞书 CLI 读取命令。",
        "",
        "请在 `.env` 里优先补 `FEISHU_READ_COMMAND`，支持 `{url}` 和 `{wikiToken}` 占位符。",
        "如果不用 CLI，再补 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 走飞书开放平台 API。"
      ].join("\n")
    };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const tenantToken = await getTenantAccessToken(fetcher, options.appId, options.appSecret);
    const node = await getWikiNode(fetcher, tenantToken, wikiToken);
    const content = await readNodeContent(fetcher, tenantToken, node);
    if (!content.trim()) {
      return {
        title: "飞书文档没读到",
        text: "飞书 API 能定位到这个 wiki 节点，但正文为空或当前应用没有正文读取权限。请确认应用已开通云文档读取权限，并且文档授权给该应用。"
      };
    }
    return {
      title: "飞书文档分析",
      text: await analyzeDocumentContent(input.query, content, options)
    };
  } catch (error) {
    return {
      title: "飞书文档没读到",
      text: [cliError ? `飞书 CLI 读取失败：${cliError.message}\n` : "", formatFeishuFailure(error)].filter(Boolean).join("\n")
    };
  }
}

async function readContentWithCommand(input: {
  command: string[];
  url: string;
  wikiToken: string;
  timeoutMs: number;
}): Promise<string> {
  const [executable, ...rawArgs] = input.command;
  if (!executable) throw new Error("FEISHU_READ_COMMAND 为空");
  const args = rawArgs.map((arg) => arg.replace(/\{url\}/g, input.url).replace(/\{wikiToken\}/g, input.wikiToken));
  const finalArgs = rawArgs.some((arg) => /\{url\}|\{wikiToken\}/.test(arg)) ? args : [...args, input.url];
  const { stdout, stderr } = await execFileAsync(executable, finalArgs, {
    timeout: input.timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  const text = parseCommandOutput(stdout);
  if (!text.trim()) throw new Error(`CLI 没有输出正文${stderr.trim() ? `：${stderr.trim().slice(0, 200)}` : ""}`);
  return text;
}

function parseCommandOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const jsonText = findJsonPayload(trimmed);
  try {
    const parsed = JSON.parse(jsonText ?? trimmed) as unknown;
    return extractTextFromJson(parsed).join("\n").trim() || (jsonText ?? trimmed);
  } catch {
    return trimmed;
  }
}

function extractTextFromJson(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(extractTextFromJson);
  const record = value as Record<string, unknown>;
  const preferredKeys = ["content", "text", "markdown", "raw_content", "title", "data", "document", "items", "blocks", "children"];
  return preferredKeys.flatMap((key) => extractTextFromJson(record[key]));
}

function findJsonPayload(input: string): string | undefined {
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "{" && char !== "[") continue;
    const candidate = input.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function getTenantAccessToken(fetcher: typeof fetch, appId: string, appSecret: string): Promise<string> {
  const result = await requestFeishu(fetcher, "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const token = asRecord(result.data).tenant_access_token;
  if (typeof token !== "string" || !token) throw new Error("飞书 tenant_access_token 获取失败：响应里没有 token");
  return token;
}

async function getWikiNode(fetcher: typeof fetch, tenantToken: string, wikiToken: string): Promise<Record<string, unknown>> {
  const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`;
  const result = await requestFeishu(fetcher, url, {
    headers: { authorization: `Bearer ${tenantToken}` }
  });
  const node = asRecord(asRecord(result.data).node);
  if (!node.obj_token && !node.node_token) throw new Error("飞书 wiki 节点解析失败：响应里没有 obj_token/node_token");
  return node;
}

async function readNodeContent(fetcher: typeof fetch, tenantToken: string, node: Record<string, unknown>): Promise<string> {
  const objType = String(node.obj_type ?? "").toLowerCase();
  const objToken = String(node.obj_token ?? node.node_token ?? "");
  if (!objToken) throw new Error("飞书 wiki 节点没有可读取 token");
  if (objType === "doc" || objType === "docs") {
    return readRawContent(fetcher, tenantToken, `https://open.feishu.cn/open-apis/doc/v2/${encodeURIComponent(objToken)}/raw_content`);
  }
  return readDocxContent(fetcher, tenantToken, objToken);
}

async function readDocxContent(fetcher: typeof fetch, tenantToken: string, documentId: string): Promise<string> {
  const rawUrl = `https://open.feishu.cn/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`;
  try {
    return await readRawContent(fetcher, tenantToken, rawUrl);
  } catch {
    const blocks = await listDocxBlocks(fetcher, tenantToken, documentId);
    return blocksToText(blocks);
  }
}

async function readRawContent(fetcher: typeof fetch, tenantToken: string, url: string): Promise<string> {
  const result = await requestFeishu(fetcher, url, {
    headers: { authorization: `Bearer ${tenantToken}` }
  });
  const data = asRecord(result.data);
  const content = data.content ?? data.text ?? data.raw_content;
  if (typeof content !== "string") throw new Error("飞书正文读取失败：响应里没有纯文本 content");
  return content;
}

async function listDocxBlocks(fetcher: typeof fetch, tenantToken: string, documentId: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let pageToken = "";
  for (let index = 0; index < 10; index += 1) {
    const url = new URL(`https://open.feishu.cn/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`);
    url.searchParams.set("document_revision_id", "-1");
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const result = await requestFeishu(fetcher, url.toString(), {
      headers: { authorization: `Bearer ${tenantToken}` }
    });
    const data = asRecord(result.data);
    const batch = Array.isArray(data.items) ? data.items : [];
    items.push(...batch.map(asRecord));
    if (!data.has_more || typeof data.page_token !== "string" || !data.page_token) break;
    pageToken = data.page_token;
  }
  return items;
}

function blocksToText(blocks: Record<string, unknown>[]): string {
  return blocks
    .map((block) => collectStrings(block).join(""))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function analyzeDocumentContent(
  query: string,
  content: string,
  options: FeishuDocumentAnalysisOptions
): Promise<string> {
  if (!options.openAiApiKey || !options.openAiBaseUrl) {
    return ["我已经读到飞书正文，但缺 LLM 配置，暂时只能给正文摘要。", "", summarizeText(content)].join("\n");
  }

  const prompt = [
    "你是一个业务文档逻辑审查助手。请基于用户给的飞书文档正文，输出简短、直给、可执行的中文分析。",
    "",
    "用户请求：",
    query,
    "",
    "文档正文：",
    content.slice(0, 18000),
    "",
    "输出要求：",
    "1. 第一行给总判断：逻辑是否基本成立，还是存在明显问题。",
    "2. 接着列 3-5 条关键问题/风险/缺口，每条都要指向文档内容里的具体逻辑。",
    "3. 最后给 1-3 条建议，不要写工程化过程，不要说自己无法判断，除非正文确实不足。"
  ].join("\n");

  const response = await requestLlmWithFallback(prompt, options);
  return extractAssistantText(response) ?? summarizeText(content);
}

async function requestLlmWithFallback(prompt: string, options: FeishuDocumentAnalysisOptions): Promise<unknown> {
  const baseUrl = options.openAiBaseUrl ?? "";
  const body = { model: options.openAiModel ?? "gpt-5.5", input: prompt };
  try {
    return await requestJson(endpoint(baseUrl, "responses"), body, options);
  } catch {
    return requestJson(
      endpoint(baseUrl, "chat/completions"),
      {
        model: options.openAiModel ?? "gpt-5.5",
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      },
      options
    );
  }
}

async function requestJson(url: string, body: unknown, options: FeishuDocumentAnalysisOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.openAiTimeoutMs ?? 60000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.openAiApiKey}`,
        "content-type": "application/json",
        ...(options.openAiUserAgent ? { "user-agent": options.openAiUserAgent } : {}),
        ...options.openAiExtraHeaders
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
    return text ? (JSON.parse(text) as unknown) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function requestFeishu(fetcher: typeof fetch, url: string, init: RequestInit): Promise<FeishuApiResult> {
  const response = await fetcher(url, init);
  const text = await response.text();
  const result = text ? (JSON.parse(text) as FeishuApiResult) : {};
  if (!response.ok || (typeof result.code === "number" && result.code !== 0)) {
    throw new Error(`飞书 API ${new URL(url).pathname} 失败：HTTP ${response.status} code=${result.code ?? "-"} msg=${result.msg ?? text.slice(0, 160)}`);
  }
  return result;
}

function extractUrls(input: string): URL[] {
  return [...input.matchAll(/https?:\/\/[^\s<>"）)]+/gi)]
    .map((match) => {
      try {
        return new URL(match[0]);
      } catch {
        return undefined;
      }
    })
    .filter((url): url is URL => Boolean(url));
}

function extractWikiToken(url: URL): string {
  const match = url.pathname.match(/\/wiki\/([^/?#]+)/i);
  if (!match?.[1]) throw new Error("飞书 wiki 链接里没有 wiki token");
  return decodeURIComponent(match[1]);
}

function extractAssistantText(response: unknown): string | undefined {
  const outputText = (response as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();
  const output = (response as { output?: Array<{ content?: Array<{ text?: unknown }> }> }).output;
  for (const item of output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) return content.text.trim();
    }
  }
  const choices = (response as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices;
  const content = choices?.[0]?.message?.content ?? choices?.[0]?.text;
  return typeof content === "string" && content.trim() ? content.trim() : undefined;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /text|content|title|elements|children|paragraph|heading|bullet|ordered|todo/i.test(key))
    .flatMap(([, child]) => collectStrings(child));
}

function summarizeText(content: string): string {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [`已读取正文，共 ${content.length} 字。`, ...lines.slice(0, 8).map((line) => `- ${line.slice(0, 120)}`)].join("\n");
}

function formatFeishuFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/99991663|permission|forbidden|403|权限|not authorized/i.test(message)) {
    return `${message}\n\n我已经尝试飞书 API，但当前应用没有读取这个文档的权限。需要给应用开通云文档读取权限，并把该知识库/文档授权给应用。`;
  }
  return `${message}\n\n这不是 Codex 不会分析，而是正文还没读出来。读到正文后我会直接做逻辑分析。`;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function endpoint(baseUrl: string, suffix: "responses" | "chat/completions"): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/responses") || trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/${suffix}`;
}
