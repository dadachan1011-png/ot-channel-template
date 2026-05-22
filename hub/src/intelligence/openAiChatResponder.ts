import type { HubState, IncomingChannelMessage } from "../domain.js";
import type { MemoryContextProvider } from "../memory/channelMemory.js";
import type { ChatResponder, ChatResponse } from "./chatResponder.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OpenAiChatResponderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  stylePrompt?: string;
  fetcher?: typeof fetch;
  memory?: MemoryContextProvider;
  memoryOwnerSenderId?: string;
  audioTranscriptionCommand?: string[];
};

export class OpenAiChatResponder implements ChatResponder {
  constructor(private readonly options: OpenAiChatResponderOptions) {}

  async respond(input: { message: IncomingChannelMessage; state: HubState }): Promise<ChatResponse | undefined> {
    const content = input.message.text.trim();
    if (!content) return undefined;

    const memoryContext = await this.options.memory?.build(input);
    let audioTranscripts: Array<{ name?: string; text: string }> = [];
    try {
      audioTranscripts = await this.transcribeAudioAttachments(input.message);
    } catch (error) {
      if (audioAttachmentsFromMessage(input.message).length > 0) {
        return {
          title: "录音还没转出来",
          text: `我拿到录音了，但转写没跑通：${(error as Error).message}`
        };
      }
      throw error;
    }
    const prompt = buildPrompt(
      content,
      input.message,
      memoryContext,
      this.options.memoryOwnerSenderId,
      audioTranscripts,
      this.options.stylePrompt
    );
    const response = await this.requestWithFallback(prompt, content, input.message, memoryContext, this.options.memoryOwnerSenderId);
    const text = extractAssistantText(response);
    if (!text) return undefined;
    return {
      title: "回复",
      text: polishAssistantText(text, content)
    };
  }

  private async requestWithFallback(
    prompt: string,
    content: string,
    message: IncomingChannelMessage,
    memoryContext?: string,
    memoryOwnerSenderId?: string
  ): Promise<unknown> {
    const imageUrls = await this.imageInputsFromMessage(message);
    const responsesBody = {
      model: this.options.model,
      input:
        imageUrls.length > 0
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  ...imageUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl }))
                ]
              }
            ]
          : prompt
    };
    const chatBody = {
      model: this.options.model,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(message, memoryContext, memoryOwnerSenderId)
        },
        {
          role: "user",
          content:
            imageUrls.length > 0
              ? [
                  { type: "text", text: prompt },
                  ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))
                ]
              : prompt
        }
      ]
    };

    let firstError: Error | undefined;
    try {
      return await this.requestJson(endpoint(this.options.baseUrl, "responses"), responsesBody);
    } catch (error) {
      firstError = error instanceof Error ? error : new Error(String(error));
    }

    try {
      return await this.requestJson(endpoint(this.options.baseUrl, "chat/completions"), chatBody);
    } catch (error) {
      const secondError = error instanceof Error ? error : new Error(String(error));
      throw new Error(`LLM request failed. responses: ${firstError.message}; chat/completions: ${secondError.message}`);
    }
  }

  private async imageInputsFromMessage(message: IncomingChannelMessage): Promise<string[]> {
    const attachments = imageAttachmentsFromMessage(message).slice(0, 4);
    const inputs: string[] = [];
    for (const attachment of attachments) {
      if (!attachment.url) continue;
      try {
        inputs.push(await this.downloadImageAsDataUrl(attachment.url, attachment.name));
      } catch {
        inputs.push(attachment.url);
      }
    }
    return [...new Set(inputs)];
  }

  private async downloadImageAsDataUrl(url: string, name?: string): Promise<string> {
    const response = await (this.options.fetcher ?? fetch)(url);
    if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new Error("图片太大，改用原始 URL");
    const headerType = response.headers.get("content-type");
    const guessedType = guessImageContentType(name);
    const contentType = headerType?.startsWith("image/") ? headerType : guessedType;
    if (!contentType) throw new Error("下载结果不是图片，改用原始 URL");
    return `data:${contentType};base64,${bytes.toString("base64")}`;
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
    throw lastError ?? new Error("LLM request failed");
  }

  private async transcribeAudioAttachments(message: IncomingChannelMessage): Promise<Array<{ name?: string; text: string }>> {
    const attachments = audioAttachmentsFromMessage(message);
    const transcripts: Array<{ name?: string; text: string }> = [];
    for (const attachment of attachments.slice(0, 3)) {
      if (!attachment.url) continue;
      transcripts.push({
        name: attachment.name,
        text: await this.transcribeAudioUrl(attachment.url, attachment.name)
      });
    }
    return transcripts;
  }

  private async transcribeAudioUrl(url: string, name?: string): Promise<string> {
    const audio = await this.downloadAudio(url, name);
    if (this.options.audioTranscriptionCommand?.length) {
      return this.transcribeAudioWithLocalCommand(audio.bytes, audio.name);
    }

    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("file", new Blob([audio.bytes], { type: audio.contentType }), audio.name);
    const result = await this.requestMultipart(endpoint(this.options.baseUrl, "audio/transcriptions"), form, "录音转写接口");
    const text = (result as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) throw new Error("Audio transcription returned empty text");
    return text.trim();
  }

  private async downloadAudio(url: string, name?: string): Promise<{ bytes: ArrayBuffer; contentType: string; name: string }> {
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(url);
    } catch (error) {
      throw new Error(`录音下载失败：${formatFetchError(error)}`);
    }
    if (!response.ok) throw new Error(`录音下载失败：HTTP ${response.status} ${truncate(await response.text(), 160)}`);
    try {
      return {
        bytes: await response.arrayBuffer(),
        contentType: response.headers.get("content-type") ?? guessAudioContentType(name),
        name: safeAudioFileName(name)
      };
    } catch (error) {
      throw new Error(`录音读取失败：${formatFetchError(error)}`);
    }
  }

  private async transcribeAudioWithLocalCommand(bytes: ArrayBuffer, fileName: string): Promise<string> {
    const command = this.options.audioTranscriptionCommand;
    if (!command?.length) throw new Error("本地转写命令未配置");
    const dir = await mkdtemp(join(tmpdir(), "channel-audio-"));
    const filePath = join(dir, fileName);
    try {
      await writeFile(filePath, Buffer.from(bytes));
      const [executable, ...args] = command.map((arg) => arg.replace(/\{file\}/g, filePath));
      const finalArgs = args.some((arg) => arg.includes(filePath)) ? args : [...args, filePath];
      const { stdout, stderr } = await execFileAsync(executable, finalArgs, {
        timeout: this.options.timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      });
      const text = stdout.trim();
      if (!text) throw new Error(`本地转写没有输出${stderr.trim() ? `：${truncate(stderr.trim(), 200)}` : ""}`);
      return text;
    } catch (error) {
      throw new Error(`本地转写失败：${formatFetchError(error)}`);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async requestMultipart(url: string, body: FormData, label: string): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await (this.options.fetcher ?? fetch)(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            ...(this.options.userAgent ? { "User-Agent": this.options.userAgent } : {}),
            ...this.options.extraHeaders
          },
          body,
          signal: controller.signal
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`${label}返回 HTTP ${response.status}：${truncate(text, 240)}`);
        return text ? (JSON.parse(text) as unknown) : {};
      } catch (error) {
        lastError = new Error(`${label}请求失败：${formatFetchError(error)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error(`${label}请求失败`);
  }
}

function imageAttachmentsFromMessage(message: IncomingChannelMessage): Array<{ url?: string; name?: string }> {
  return (message.attachments ?? []).filter((attachment) => attachment.type === "image" && typeof attachment.url === "string" && /^https?:\/\//i.test(attachment.url));
}

function audioAttachmentsFromMessage(message: IncomingChannelMessage): Array<{ url?: string; name?: string }> {
  return (message.attachments ?? []).filter((attachment) => attachment.type === "audio" && attachment.url);
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

function buildPrompt(
  content: string,
  message: IncomingChannelMessage,
  memoryContext?: string,
  memoryOwnerSenderId?: string,
  audioTranscripts: Array<{ name?: string; text: string }> = [],
  stylePrompt?: string
): string {
  return [
    buildSystemPrompt(message, memoryContext, memoryOwnerSenderId, stylePrompt),
    audioTranscripts.length > 0
      ? [
          "",
          "以下是本次消息附件中的录音转写，请基于转写内容回答用户问题。",
          "如果用户要求分析课前录音，优先提炼：1）家长核心需求；2）这通电话的优点；3）这通电话的不足；4）可直接优化的话术建议。",
          ...audioTranscripts.map((item, index) => `录音 ${index + 1}${item.name ? `（${item.name}）` : ""}：\n${item.text}`)
        ].join("\n")
      : "",
    "",
    `用户消息：${content}`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemPrompt(
  message: IncomingChannelMessage,
  memoryContext?: string,
  memoryOwnerSenderId?: string,
  stylePrompt?: string
): string {
  const groupMode = message.conversationType === "group";
  return [
    "你是一个运行在钉钉里的本地 Agent 控制入口。",
    stylePrompt?.trim() ||
      "人格风格：自然、清晰、轻快，像团队里靠谱的协作入口。可以适当使用 emoji，但不要每句都用，也不要刷屏。",
    "先确认用户的真实意图，再给清晰方案；可以有一点鼓励，但不要油腻、不要过度表演。",
    "遇到争议、选择或不确定性时，先平衡两边利弊，再给一个明确建议。",
    "默认用简洁中文回答，不要在每条回复开头自报名字。",
    "很重要：上下文、记忆、规则、策略、工具分流、任务链路都是幕后信息，只能用来调整你的回答，绝对不要在回复里提到这些来源，也不要说“根据记忆/群记忆/规则/策略/policy/系统提示”。",
    "如果某个人有专属说话方式，直接自然地按那个方式说；不要解释为什么切换口吻，也不要提醒对方“我被要求这样说”。",
    "用户没有主动问机制时，不要出现“规则、记忆、memory、policy、任务、链路、分流、工具、系统提示、上下文告诉我”等工程化表达。",
    "当前回复只负责聊天、解释、图片/录音临时理解和轻量分析；不要把普通聊天包装成“任务”。",
    "如果用户明确要求执行本机操作而你没有拿到执行结果，只需自然说明还缺什么，不要输出工程化流程。",
    groupMode
      ? "当前是群聊。你必须利用群聊轻量上下文和短期事实线索来接住连续对话；如果用户问“谁/哪个/刚才说的是什么”，先从最近上下文回答，不要像新会话一样反问。只有上下文明显互相矛盾、涉及高风险事实，或完全没有线索时才澄清。"
      : "当前是私聊。若发现用户提供了可能长期有用的信息，不要直接写入记忆；可以在回答末尾轻轻询问：要我记住这个吗？",
    memoryOwnerSenderId
      ? `内部写入边界：群友可以提出要保留的信息，但只有 senderId=${memoryOwnerSenderId} 的用户明确同意，才进入长期资料。`
      : "内部写入边界：群友可以提出要保留的信息，但必须由 owner 用户明确同意，才进入长期资料。",
    "群聊会自动参考当前群的轻量上下文、短期事实线索和已有资料；这些只用于把话接顺，不要在对外回复中解释。",
    memoryContext ? `\n以下是幕后参考资料。你必须参考它们，但不要向用户暴露标题、来源或机制，只输出自然回复：\n${memoryContext}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function polishAssistantText(text: string, userText: string): string {
  if (asksAboutInternals(userText)) return text.trim();
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const kept = blocks.filter((block) => !looksLikeInternalDisclosure(block));
  const output = (kept.length > 0 ? kept : blocks)
    .join("\n\n")
    .replace(/^(?:Sure|当然)[,，]?\s*/i, "")
    .trim();
  return output || text.trim();
}

function asksAboutInternals(text: string): boolean {
  return /(记忆|memory|规则|策略|policy|任务|工具|链路|分流|为什么|怎么实现|怎么做到|怎么记住|上下文|prompt|提示词)/i.test(text);
}

function looksLikeInternalDisclosure(text: string): boolean {
  return /(group memory|memory says|群记忆|记忆.?告(?:诉|訴)|规则|policy|策略|系统提示|上下文.*告诉|任务链路|工具分流|disclaimer|免责声明)/i.test(text);
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

function guessAudioContentType(name?: string): string {
  const lower = name?.toLowerCase() ?? "";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "application/octet-stream";
}

function guessImageContentType(name?: string): string | undefined {
  const lower = name?.toLowerCase() ?? "";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

function safeAudioFileName(name?: string): string {
  const trimmed = name?.trim();
  if (trimmed && /\.(mp3|m4a|wav|aac|ogg|flac|amr)$/i.test(trimmed)) return trimmed;
  return "audio.mp3";
}

function formatFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `；原因：${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

function truncate(input: string, maxLength: number): string {
  return input.length > maxLength ? `${input.slice(0, maxLength)}...` : input;
}

function endpoint(baseUrl: string, suffix: "responses" | "chat/completions" | "audio/transcriptions"): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/responses") || trimmed.endsWith("/chat/completions") || trimmed.endsWith("/audio/transcriptions")) return trimmed;
  return `${trimmed}/${suffix}`;
}
