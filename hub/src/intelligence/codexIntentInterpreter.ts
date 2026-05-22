import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { parseCommand } from "../commands/parser.js";
import type { HubState, IncomingChannelMessage } from "../domain.js";
import { formatToolCapabilitiesForPlanner, parseRegisteredToolIntent } from "../tools/capabilityRegistry.js";
import type { IntentInterpreter, InterpretedIntent } from "./intent.js";

const llmIntentSchema = z.object({
  kind: z.enum([
    "ping",
    "channels_status",
    "status",
    "codex",
    "cancel",
    "confirm",
    "reply",
    "route",
    "quiet",
    "help",
    "assistant_reply",
    "unknown"
  ]),
  confidence: z.number().min(0).max(1).default(0),
  target: z.string().nullable().default(null),
  abnormalOnly: z.boolean().default(false),
  prompt: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  answer: z.enum(["yes", "no"]).nullable().default(null),
  replyText: z.string().nullable().default(null),
  routeChannel: z.enum(["dingtalk", "lark", "both"]).nullable().default(null),
  persistent: z.boolean().default(false),
  quietScope: z.enum(["today", "low_priority"]).nullable().default(null),
  responseTitle: z.string().nullable().default(null),
  responseText: z.string().nullable().default(null)
});

type LlmIntent = z.infer<typeof llmIntentSchema>;
type LlmIntentProvider = (input: {
  message: IncomingChannelMessage;
  state: HubState;
  prompt: string;
}) => Promise<unknown>;

export class CodexIntentInterpreter implements IntentInterpreter {
  constructor(
    private readonly options: {
      codexCliPath: string;
      codexCliArgsPrefix?: string[];
      model?: string;
      reasoningEffort?: string;
      timeoutMs: number;
      cwd: string;
      codexStateRoot?: string;
      fallback?: IntentInterpreter;
      intentProvider?: LlmIntentProvider;
    }
  ) {}

  async interpret(input: { message: IncomingChannelMessage; state: HubState }): Promise<InterpretedIntent> {
    const ruleBased = parseCommand(input.message.text);
    if (isDeterministicLocalCommand(input.message.text, ruleBased)) return ruleBased;
    const codexRuntimeEta = parseCodexRuntimeEtaQuery(input.message.text, this.options.codexStateRoot);
    if (codexRuntimeEta) return codexRuntimeEta;
    const registeredToolIntent = parseRegisteredToolIntent(input.message.text, input.state);
    if (registeredToolIntent) return registeredToolIntent;
    const linkReviewTask = parseExternalLinkReviewTask(input.message.text);
    if (linkReviewTask) return linkReviewTask;
    const casualTransparencyReply = parseCasualTransparencyReply(input.message.text);
    if (casualTransparencyReply) return casualTransparencyReply;
    const explicitCodexTask = parseExplicitCodexTask(input.message.text);
    if (explicitCodexTask) return explicitCodexTask;
    if (isLikelyGeneralChat(input.message.text)) return this.options.fallback?.interpret(input) ?? ruleBased;

    try {
      const llmIntent = await this.callCodex(input.message, input.state);
      const interpreted = this.toIntent(llmIntent);
      if (interpreted) return interpreted;
    } catch (error) {
      console.warn(`[channel-hub] Codex intent interpreter failed: ${formatCodexError(error)}`);
      // The bridge must remain usable if Codex is busy or unavailable.
    }

    const semantic = interpretCommonSpeech(input.message.text);
    if (semantic) return semantic;
    if (ruleBased.kind !== "unknown") return ruleBased;

    return this.options.fallback?.interpret(input) ?? ruleBased;
  }

  private async callCodex(message: IncomingChannelMessage, state: HubState): Promise<LlmIntent> {
    const prompt = buildPrompt(message, state);
    if (this.options.intentProvider) {
      return llmIntentSchema.parse(await this.options.intentProvider({ message, state, prompt }));
    }

    const dir = await mkdtemp(join(tmpdir(), "channel-hub-intent-"));
    const schemaPath = join(dir, "intent.schema.json");
    const outputPath = join(dir, "intent.json");
    try {
      await writeFile(schemaPath, JSON.stringify(intentJsonSchema(), null, 2), "utf8");
      const args = buildCodexIntentArgs({
        prefix: this.options.codexCliArgsPrefix ?? [],
        schemaPath,
        outputPath,
        model: this.options.model,
        reasoningEffort: this.options.reasoningEffort
      });

      await runCodex(this.options.codexCliPath, args, prompt, {
        cwd: this.options.cwd,
        timeout: this.options.timeoutMs,
        maxBuffer: 1024 * 1024
      });

      const raw = await readFile(outputPath, "utf8");
      return llmIntentSchema.parse(JSON.parse(raw));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private toIntent(intent: LlmIntent): InterpretedIntent | undefined {
    if (intent.confidence < 0.55) return undefined;

    if (intent.kind === "assistant_reply") {
      if (!intent.responseText) return undefined;
      return {
        kind: "assistant_reply",
        title: intent.responseTitle ?? "回复",
        text: intent.responseText
      };
    }

    if (intent.kind === "unknown") {
      return intent.responseText
        ? {
            kind: "assistant_reply",
            title: intent.responseTitle ?? "我需要确认你的意思",
            text: intent.responseText
          }
        : undefined;
    }

    if (intent.kind === "status") return { kind: "status", target: intent.target ?? undefined, abnormalOnly: intent.abnormalOnly };
    if (intent.kind === "codex" && intent.prompt) return { kind: "codex", prompt: intent.prompt, name: intent.name ?? undefined };
    if (intent.kind === "cancel") return { kind: "cancel", target: intent.target ?? undefined };
    if (intent.kind === "confirm" && intent.answer) return { kind: "confirm", target: intent.target ?? undefined, answer: intent.answer };
    if (intent.kind === "reply" && intent.replyText) return { kind: "reply", target: intent.target ?? undefined, text: intent.replyText };
    if (intent.kind === "route" && intent.routeChannel) {
      return { kind: "route", target: intent.target ?? undefined, channel: intent.routeChannel, persistent: intent.persistent };
    }
    if (intent.kind === "quiet") return { kind: "quiet", scope: intent.quietScope ?? "low_priority" };
    if (intent.kind === "help") return { kind: "help" };
    if (intent.kind === "ping") return { kind: "ping" };
    if (intent.kind === "channels_status") return { kind: "channels_status" };

    return undefined;
  }
}

function isDeterministicLocalCommand(text: string, intent: InterpretedIntent): boolean {
  if (intent.kind === "unknown" || intent.kind === "assistant_reply") return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) return true;
  return ["ping", "channels_status", "confirm", "reply", "cancel", "route", "quiet", "help"].includes(intent.kind);
}

function parseCodexRuntimeEtaQuery(input: string, codexStateRoot?: string): InterpretedIntent | undefined {
  const text = input.trim();
  const compact = text.replace(/\s+/g, "");
  if (!/codex/i.test(compact)) return undefined;
  if (!/(任务|task|session|会话)/i.test(compact)) return undefined;
  if (!/(现在|当前|在跑|正在跑|运行中|running|active)/i.test(compact)) return undefined;
  if (!/(多久|多长时间|预计|预估|估计|ETA|完成|结束|剩余|还要)/i.test(compact)) return undefined;

  return {
    kind: "codex",
    name: "评估 Codex 运行任务 ETA",
    routeMode: "planned_task",
    prompt: [
      "请在本机 Codex 环境中只读检查当前 Channel/DingTalk bridge 记录的 Codex 任务状态，并回答用户关于正在运行任务和预计完成时间的问题。",
      `用户原始请求：${text}`,
      "优先读取当前 channel 项目的 dingtalk/.local/state.json、hub/.local/state.json，以及相关日志目录。",
      `同时检查 Codex 桌面端/客户端状态，因为 DingTalk bridge 的状态只覆盖通过钉钉 channel 启动的任务。Codex 状态根目录优先使用 HUB_CODEX_STATE_ROOT；当前配置值为：${codexStateRoot || "<未配置>"}`,
      "如已配置 Codex 状态根目录，请读取其中的 state_*.sqlite、session_index.jsonl、sessions/**/rollout-*.jsonl，用来发现 Codex App/VS Code/client 中活跃或最近活跃的会话。",
      "回答必须分成两组：1）DingTalk/channel bridge 管理的任务；2）从 Codex 本地状态推断出的桌面端/客户端活跃或最近活跃会话。除非两组都检查过，否则不要说当前只有 1 个任务。",
      "Codex 桌面端/客户端会话没有可靠的官方剩余时间字段；请基于 updated_at、rollout 文件修改时间、source、cwd、title、model、reasoning_effort、可见 codex/node_repl 进程来推断活跃度。ETA 证据不足时标注为“无法可靠估计”。",
      "需要列出：正在运行/排队/等待确认的任务、任务名、状态、开始时间或已运行时间、最近进展、是否有阻塞、预计剩余时间或无法估计的原因。",
      "如果没有足够证据估算 ETA，不要编造；请说明依据不足，并给出最接近的可判断状态。不要修改文件，不要启动服务，不要取消任务。"
    ].join("\n")
  };
}

function isLikelyGeneralChat(input: string): boolean {
  const text = input.trim();
  const compact = text.replace(/\s+/g, "");
  if (!compact) return false;
  if (text.startsWith("/")) return false;
  if (/(帮我|替我|给我|检查|查看|看下|看一下|跑|执行|改|修改|创建|启动|停止|取消|同意|不同意|补充|状态|进度|异常|报错|失败|卡住|项目|仓库|repo|codex|任务|确认|飞书|钉钉|路由|通知|channel)/i.test(compact)) {
    return false;
  }
  if (compact.length <= 24 && /(今天在忙啥|在忙啥|忙什么|干嘛|干什么|聊聊|你在吗|在不在)/.test(compact)) {
    return true;
  }
  if (compact.length <= 24 && /^(你是谁|你能做什么|你是什么|这是什么|.*是什么|.*什么意思|.*怎么理解|.*为什么|.*吗|.*呢|\?|？)/.test(compact)) {
    return true;
  }
  return compact.length <= 40 && /[?？]$/.test(compact);
}

function parseCasualTransparencyReply(input: string): InterpretedIntent | undefined {
  const compact = input.trim().replace(/\s+/g, "");
  if (!/(瞒我|瞒着我|隐瞒|藏着什么|有什么事瞒)/.test(compact)) return undefined;
  if (/(任务|状态|进展|异常|失败|阻塞|在跑|运行|ETA|多久|项目|Codex|codex)/i.test(compact)) return undefined;
  return {
    kind: "assistant_reply",
    title: "没有藏事",
    text: "没有瞒你啦 🙂 这句我先按玩笑接住，不展开后台信息。"
  };
}

function parseExplicitCodexTask(input: string): InterpretedIntent | undefined {
  const text = input.trim();
  const explicit =
    /(?:用|让|叫|请|麻烦)?\s*codex\s*(?:帮我|给我|去)?\s*(?:查|查询|查看|看|列出|统计|检查|执行|跑)/i.test(text) ||
    /(?:帮我|给我|替我|麻烦你|请)\s*(?:查|查询|查看|看|列出|统计|检查)\s*codex/i.test(text) ||
    /(?:用|让|叫)\s*codex/i.test(text);
  if (!explicit) return undefined;

  return {
    kind: "codex",
    name: inferExplicitCodexTaskName(text),
    routeMode: "direct_action",
    prompt: [
      "请在本机 Codex 环境中执行用户明确要求的只读查询任务。",
      `用户原始请求：${text}`,
      "如果请求涉及“当前 Codex 有几个项目、列出项目名、项目列表”，请优先检查当前允许工作区、当前仓库目录，以及可见的项目/工作区线索；输出项目数量、项目名称和判断依据。",
      "默认只读，不要修改文件，不要启动长期服务，不要做破坏性操作。",
      "结果直接给出结论；如果无法确认，说明检查了哪些位置、缺少什么证据。"
    ].join("\n")
  };
}

function parseExternalLinkReviewTask(input: string): InterpretedIntent | undefined {
  const text = input.trim();
  const urls = [...text.matchAll(/https?:\/\/[^\s<>"）)]+/gi)].map((match) => match[0]);
  if (urls.length === 0) return undefined;
  const compact = text.replace(/\s+/g, "");
  if (!/(打开|点开|访问|看看|看下|看一下|检查|分析|判断|审一下|帮我看|能不能看|有没有问题|逻辑)/i.test(compact)) {
    return undefined;
  }

  const urlList = urls.map((url, index) => `${index + 1}. ${url}`).join("\n");
  const targetType = /feishu|飞书|my\.feishu\.cn|wiki/i.test(text) ? "飞书文档/知识库链接" : "外部链接";
  return {
    kind: "codex",
    name: `检查${targetType}`.slice(0, 24),
    routeMode: "planned_task",
    prompt: [
      "你正在通过 Channel Hub 的注册工具能力执行任务：feishu_document_read_analyze（飞书文档读取与逻辑分析）。",
      `请检查用户发来的${targetType}，判断其内容逻辑是否有问题。`,
      "",
      "用户原始请求：",
      text,
      "",
      "链接：",
      urlList,
      "",
      "执行要求：",
      "1. 先尝试直接访问链接并读取页面内容；如果需要登录、权限或验证码，请明确说明卡在哪一步，不要假装已经读到内容。",
      "2. 如果能读取内容，优先检查：结构是否自洽、前后逻辑是否矛盾、关键假设是否缺证据、结论和动作是否可执行。",
      "3. 输出要短：先给一句结论，再列 3-5 条最关键问题或确认点。",
      "4. 不要修改任何文件，不要保存链接内容；只做临时读取和分析。"
    ].join("\n")
  };
}

function inferExplicitCodexTaskName(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/项目|project/i.test(normalized) && /(几个|多少|列出|列表|名称|名字)/.test(normalized)) return "查询 Codex 项目列表";
  return normalized.replace(/^(用|让|叫|请|麻烦你|帮我|给我|替我)\s*/i, "").slice(0, 24) || "Codex 查询任务";
}

export function buildCodexIntentArgs(input: {
  prefix?: string[];
  schemaPath: string;
  outputPath: string;
  model?: string;
  reasoningEffort?: string;
}): string[] {
  const args = [
    ...(input.prefix ?? []),
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.outputPath
  ];
  if (input.model) args.push("--model", input.model);
  if (input.reasoningEffort) args.push("-c", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`);
  args.push("-");
  return args;
}

function runCodex(
  command: string,
  args: string[],
  stdin: string,
  options: { cwd: string; timeout: number; maxBuffer: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex intent timed out after ${options.timeout}ms\n${stderr || stdout}`));
    }, options.timeout);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > options.maxBuffer) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > options.maxBuffer) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Codex intent exited with code ${String(code)}\n${stderr || stdout}`));
    });

    child.stdin.end(stdin);
  });
}

function formatCodexError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as Error & { stdout?: string; stderr?: string; code?: unknown };
  return [error.message, extra.code !== undefined ? `code=${String(extra.code)}` : undefined, extra.stderr, extra.stdout]
    .filter(Boolean)
    .join("\n");
}

export class RuleBasedIntentInterpreter implements IntentInterpreter {
  async interpret(input: { message: IncomingChannelMessage; state: HubState }): Promise<InterpretedIntent> {
    const ruleBased = parseCommand(input.message.text);
    if (ruleBased.kind !== "unknown") return ruleBased;
    return interpretCommonSpeech(input.message.text) ?? ruleBased;
  }
}

export function interpretCommonSpeech(input: string): InterpretedIntent | undefined {
  const text = input.trim();
  const compact = text.replace(/\s+/g, "");

  const progressInvestigation = parseProjectProgressInvestigationRequest(text);
  if (progressInvestigation) {
    return buildProjectProgressInvestigationIntent(progressInvestigation.project, progressInvestigation.focus);
  }

  if (/(卡住|阻塞|失败|异常|报错|有问题|待处理|要处理|需要处理)/.test(compact) && /(看|查|有没有|哪些|现在|今天|帮我)/.test(compact)) {
    return { kind: "status", abnormalOnly: true };
  }

  if (/(现在|当前|今天|整体|全部|所有)/.test(compact) && /(情况|状态|进展|怎么样)/.test(compact)) {
    return { kind: "status" };
  }

  const projectStatus = text.match(/^(.+?)\s*(?:运行[得的]?|跑[得的]?|进展|状态|情况)?\s*(?:怎么样了?|如何|咋样|怎样|正常吗|还好吗)\??$/i);
  if (projectStatus && projectStatus[1]) {
    const target = projectStatus[1].trim();
    if (target && !/^(现在|当前|今天|整体|全部|所有|这个|那个)$/.test(target)) {
      return { kind: "status", target };
    }
  }

  const projectProgress = text.match(/^(.+?)\s*(?:运行[得的]?|跑[得的]?|进展|状态|情况)\s*(?:怎么样了?|如何|咋样|怎样)?[\s，,。；;]*(?:你觉得|预计|估计)?(?:还要|还需要|需要)?多久.*$/i);
  if (projectProgress && projectProgress[1]) {
    const target = projectProgress[1].trim();
    if (target && !/^(现在|当前|今天|整体|全部|所有|这个|那个)$/.test(target)) {
      return { kind: "status", target };
    }
  }

  const projectReview = text.match(/^(?:帮我|请|麻烦你|你来|给我)?\s*(?:看看|看一下|检查|评审|审视|分析)\s*([A-Za-z0-9_-]+)\s*(?:项目|工程|仓库)?(.+)$/i);
  if (projectReview && /(完整性|模块|设计|架构|业务逻辑|依赖|划分|规划|方案|文档)/.test(projectReview[2])) {
    const project = normalizeKnownProjectName(projectReview[1]);
    const focus = projectReview[2].replace(/^的/u, "").trim();
    return {
      kind: "codex",
      name: `检查 ${project} ${focus}`.slice(0, 24),
      prompt: [
        `请在 ${project} 项目中检查${focus}。`,
        "按 Codex App 同等工程标准执行：先读取项目 AGENTS.md/README/PROJECT/MEMORY 等上下文，再检查相关目录、代码、配置和文档。",
        "输出要直接给结论、主要证据、缺口和下一步建议；不要只说缺少材料。除非用户明确要求，不要修改文件。"
      ].join("\n")
    };
  }

  if (/(渠道|通道|channel|channels)/i.test(text) && /(状态|健康|doctor|status)/i.test(text)) {
    return { kind: "channels_status" };
  }

  const cancelNumber = compact.match(/(?:第?(\d+|一|二|三|四|五|六|七|八|九|十)个?)(?:先)?(?:别做|不用做|停掉|取消|先停|暂停)/);
  if (cancelNumber) return { kind: "cancel", target: chineseNumberToDigit(cancelNumber[1]) };

  if (/(这个|当前|这件事|这条)/.test(compact) && /(别做|不用做|停掉|取消|先停|暂停)/.test(compact)) {
    return { kind: "cancel" };
  }

  const routeLark = /(飞书|lark)/i.test(text) && /(归档|留档|同步|总结|发过去|发一下|发)/.test(compact);
  if (routeLark) return { kind: "route", channel: "lark", persistent: false };

  const routeDingTalk = /(钉钉|dingtalk)/i.test(text) && /(提醒|发过去|发一下|发|通知)/.test(compact);
  if (routeDingTalk) return { kind: "route", channel: "dingtalk", persistent: false };

  if (/(太死板|不智能|听不懂|不好用|无法工作|别让我记命令|自然语言)/.test(compact)) {
    return {
      kind: "assistant_reply",
      title: "我会按自然语言理解",
      text: "收到。你可以直接说目标，不用记固定命令。我会先判断是查询、确认、取消、补充、路由还是需要追问；判断不准时会告诉你怎么说。"
    };
  }

  return undefined;
}

function normalizeKnownProjectName(input: string): string {
  const normalized = input.trim();
  if (/^foudation$/i.test(normalized)) return "foundation";
  return normalized;
}

function parseProjectProgressInvestigationRequest(input: string): { project: string; focus: string } | undefined {
  const match = input.match(
    /^(?:帮我|请|麻烦你|你来|给我)?\s*(?:看看|看一下|看下|查一下|检查|评估|判断|分析)?\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*(?:项目|工程|仓库|repo|repository)?(?:下|里|里面|中的|的)?(.+)$/i
  );
  if (!match) return undefined;

  const project = normalizeKnownProjectName(match[1]);
  const focus = match[2].trim();
  const compactFocus = focus.replace(/\s+/g, "");
  const asksProgress = /(开发进度|任务进度|当前进展|进展|工作量|里程碑|在跑|会话|session|阻塞|风险)/i.test(compactFocus);
  const asksEta = /(多久|多远|预计|估计|ETA|完成时间|何时|什么时候|剩下|剩余)/i.test(compactFocus);
  const asksCompletion = /(完成|做完|收尾|没做完|还差|剩余|完成度|开发到哪|全部任务|快做完)/i.test(compactFocus);
  if (!((asksProgress && (asksEta || asksCompletion)) || asksCompletion)) return undefined;

  return { project, focus };
}

function buildProjectProgressInvestigationIntent(project: string, focus: string): InterpretedIntent {
  return {
    kind: "codex",
    name: `评估 ${project} 开发进度`.slice(0, 24),
    prompt: [
      `请在 ${project} 项目中做一次只读开发进度评估，回答用户问题：${focus}`,
      "按 Codex App 同等工程标准执行：先读取项目 AGENTS.md/README/PROJECT/MEMORY 等上下文，再检查任务/计划文档、git 状态和最近提交、日志、运行进程、测试结果、自动化结果或本地状态文件。",
      "不要修改文件，不要只列进程或固定状态；如果证据不足，必须明确哪些结论无法可靠判断，并说明还缺什么证据。",
      "输出必须包含：结论、当前开发进度/完成度、已完成、正在进行、未完成/剩余工作、预计还需要多久及估算依据、关键证据、风险/阻塞、下一步建议。"
    ].join("\n")
  };
}

function chineseNumberToDigit(value: string): string {
  const map: Record<string, string> = {
    一: "1",
    二: "2",
    三: "3",
    四: "4",
    五: "5",
    六: "6",
    七: "7",
    八: "8",
    九: "9",
    十: "10"
  };
  return map[value] ?? value;
}

function buildPrompt(message: IncomingChannelMessage, state: HubState): string {
  return [
    "你是 Channel Hub 的中文对话意图理解层。",
    "把用户自然语言转成安全、可执行的意图；如果不适合执行，就给出自然回复或追问。",
    "用户不应该被迫记命令。尽量理解口语，例如：'帮我看下现在有没有卡住的' 是 status abnormalOnly；'第二个先别做了' 是 cancel target 2；'这事你自己总结发飞书' 是 route lark。",
    "先按能力目录做规划，而不是按关键词死匹配：chat=普通对话；status=Channel Hub 已知状态；codex=需要调用本机 Codex/工具执行的只读查询、项目检查、文件/日志/报表/系统目录查询或代码任务；assistant_reply=缺少关键入口时只问一个问题。",
    "当前已注册工具能力：",
    formatToolCapabilitiesForPlanner(),
    "除非用户明确询问任务、状态、进展、异常、在跑任务或 ETA，不要主动引用 activeTasks；像“你是不是瞒我/有什么瞒着我”这类话默认按轻松聊天处理。",
    "凡是用户说“帮我看/查/找/列/整理/检查/分析/判断”且目标是业务系统、BI、报表、目录、项目、文件、后台、数据、日志、任务、运行状态，默认这是工具任务，应返回 codex，而不是给话术建议。",
    "BI/报表/业务线查询规则：如果用户要查 BI 系统、报表目录、报表名称、业务线、仪表盘或权限，应返回 codex。prompt 要求先从记忆/知识库/配置/当前工作区查找 BI 入口和上下文；能定位入口就执行查询，不能定位时只说明缺少的唯一关键信息。",
    "先判断是否需要深度评估：只要用户在问某个项目的开发进度、完成度、质量、风险、ETA、剩余任务、阻塞原因、方案评审或预计完成时间，就应返回 codex，并把问题转成项目内只读检查任务。",
    "status 只用于列出 Channel Hub 已知的当前任务、待确认、异常和渠道状态；不要用 status 回答项目开发进度、完成度、质量、风险、ETA 或需要证据分析的问题。",
    "如果用户说'帮我看看/检查/分析 X 项目的开发进度、完成度、剩余任务、在跑会话、还要多久'，这是 codex 任务，不是 status/unknown；prompt 必须要求进入项目检查上下文、计划/任务、git、日志、进程和状态文件，并输出证据化进度评估、ETA、风险和下一步。",
    "安全规则：不要凭含糊话批准高风险动作。多个待确认时，裸 '同意/继续/处理掉' 应追问。涉及安全、账号、凭据、破坏性、长期配置时，必须倾向追问或确认。",
    "回复规则：如果只是闲聊、说明、抱怨或反馈，返回 assistant_reply，用简短中文回应，并告诉下一步会怎么处理。",
    "如果无法理解，responseText 必须告诉用户可以怎么说，给 2-4 个可直接使用的表达。",
    "",
    "当前输入和上下文：",
    JSON.stringify({
      channel: message.channel,
      text: message.text,
      activeTasks: state.tasks
        .filter((task) => ["queued", "running", "blocked", "waiting_confirmation"].includes(task.status))
        .map((task) => ({
          no: task.visibleNo,
          id: task.id,
          name: task.name,
          status: task.status,
          recent: task.lastProgress ?? task.prompt ?? null,
          sessionKey: task.metadata?.sessionKey ?? null
        })),
      pendingConfirmations: state.confirmations
        .filter((confirmation) => confirmation.status === "pending")
        .map((confirmation) => ({
          no: confirmation.visibleNo,
          id: confirmation.id,
          title: confirmation.title,
          body: confirmation.body
        }))
    })
  ].join("\n");
}

function intentJsonSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        enum: ["ping", "channels_status", "status", "codex", "cancel", "confirm", "reply", "route", "quiet", "help", "assistant_reply", "unknown"]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      target: { type: ["string", "null"] },
      abnormalOnly: { type: "boolean" },
      prompt: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      answer: { type: ["string", "null"], enum: ["yes", "no", null] },
      replyText: { type: ["string", "null"] },
      routeChannel: { type: ["string", "null"], enum: ["dingtalk", "lark", "both", null] },
      persistent: { type: "boolean" },
      quietScope: { type: ["string", "null"], enum: ["today", "low_priority", null] },
      responseTitle: { type: ["string", "null"] },
      responseText: { type: ["string", "null"] }
    },
    required: [
      "kind",
      "confidence",
      "target",
      "abnormalOnly",
      "prompt",
      "name",
      "answer",
      "replyText",
      "routeChannel",
      "persistent",
      "quietScope",
      "responseTitle",
      "responseText"
    ]
  };
}
