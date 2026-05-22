import type { HubState, IncomingChannelMessage } from "../domain.js";

export type OpenAiIntentProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  fetcher?: typeof fetch;
};

export class OpenAiIntentProvider {
  constructor(private readonly options: OpenAiIntentProviderOptions) {}

  async provide(input: { message: IncomingChannelMessage; state: HubState; prompt: string }): Promise<unknown> {
    const plannerPrompt = buildPlannerPrompt(input.prompt);
    const response = await this.requestWithFallback(plannerPrompt);
    const text = extractAssistantText(response);
    if (!text) throw new Error("OpenAI intent planner returned empty text");
    return parseJsonObject(text);
  }

  private async requestWithFallback(prompt: string): Promise<unknown> {
    let firstError: Error | undefined;
    try {
      return await this.requestJson(endpoint(this.options.baseUrl, "responses"), {
        model: this.options.model,
        input: prompt,
        text: { format: { type: "json_object" } }
      });
    } catch (error) {
      firstError = error instanceof Error ? error : new Error(String(error));
    }

    try {
      return await this.requestJson(endpoint(this.options.baseUrl, "chat/completions"), {
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是 Channel Hub 的轻量意图规划器。只输出 JSON，不要输出 Markdown。"
          },
          {
            role: "user",
            content: prompt
          }
        ]
      });
    } catch (error) {
      const secondError = error instanceof Error ? error : new Error(String(error));
      throw new Error(`OpenAI intent planner failed. responses: ${firstError.message}; chat/completions: ${secondError.message}`);
    }
  }

  private async requestJson(url: string, body: unknown): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        return await fetchJson(url, {
          fetcher: this.options.fetcher ?? fetch,
          timeoutMs: this.options.timeoutMs,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
            ...(this.options.userAgent ? { "User-Agent": this.options.userAgent } : {}),
            ...this.options.extraHeaders
          },
          body
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error("OpenAI intent planner request failed");
  }
}

function buildPlannerPrompt(basePrompt: string): string {
  return [
    basePrompt,
    "",
    "Planner 输出要求：",
    "只输出一个 JSON 对象，字段必须符合下面形状。",
    "{",
    '  "kind": "ping|channels_status|status|codex|cancel|confirm|reply|route|quiet|help|assistant_reply|unknown",',
    '  "confidence": 0.0,',
    '  "target": null,',
    '  "abnormalOnly": false,',
    '  "prompt": null,',
    '  "name": null,',
    '  "answer": null,',
    '  "replyText": null,',
    '  "routeChannel": null,',
    '  "persistent": false,',
    '  "quietScope": null,',
    '  "responseTitle": null,',
    '  "responseText": null',
    "}",
    "如果需要执行工具、查系统、查项目、查文件、查报表、查目录、跑命令、读取本机状态，请优先输出 kind=codex，并把 prompt 写成可执行任务说明。",
    "如果缺少唯一关键入口或账号信息，输出 kind=assistant_reply，只问一个最关键问题；不要教学用户如何重新提问。",
    "如果只是普通聊天或概念解释，输出 kind=assistant_reply。"
  ].join("\n");
}

async function fetchJson(
  url: string,
  input: {
    fetcher: typeof fetch;
    timeoutMs: number;
    headers: Record<string, string>;
    body: unknown;
  }
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetcher(url, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${text}`);
    return text ? (JSON.parse(text) as unknown) : {};
  } finally {
    clearTimeout(timer);
  }
}

function extractAssistantText(response: unknown): string | undefined {
  const outputText = (response as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();

  const output = (response as { output?: Array<{ content?: Array<{ text?: unknown; type?: unknown }> }> }).output;
  for (const item of output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) return content.text.trim();
    }
  }

  const choices = (response as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices;
  const first = choices?.[0];
  const content = first?.message?.content ?? first?.text;
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  return trimmed || undefined;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]) as unknown;
    const object = trimmed.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]) as unknown;
    throw new Error(`OpenAI intent planner returned non-JSON text: ${trimmed.slice(0, 200)}`);
  }
}

function endpoint(baseUrl: string, suffix: "responses" | "chat/completions"): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/responses") || trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/${suffix}`;
}
