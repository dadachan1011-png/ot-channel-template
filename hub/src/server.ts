import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { ChannelEnvelope, ChannelName, IncomingChannelMessage } from "./domain.js";
import { defaultChannelCapabilities } from "./adapters/capabilities.js";
import { ChannelRegistry } from "./adapters/registry.js";
import { HttpNotifyAdapter } from "./adapters/httpNotifyAdapter.js";
import { ChannelHub } from "./hub/channelHub.js";
import { LocalProjectContext } from "./context/localProjectContext.js";
import { CodexIntentInterpreter, RuleBasedIntentInterpreter } from "./intelligence/codexIntentInterpreter.js";
import { OpenAiChatResponder } from "./intelligence/openAiChatResponder.js";
import { OpenAiIntentProvider } from "./intelligence/openAiIntentProvider.js";
import { FileMemoryContextProvider } from "./memory/channelMemory.js";
import { JsonStore } from "./store/jsonStore.js";

const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
const channelSchema = z.enum(["dingtalk", "lark"]);

const envelopeSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["task", "confirmation", "automation_result", "report", "error", "chat"]),
  priority: prioritySchema,
  project: z.string().optional(),
  source: z.enum(["codex", "script", "automation", "user", "channel"]),
  requiresReply: z.boolean().default(false),
  preferredChannel: z.enum(["auto", "dingtalk", "lark", "both"]).default("auto"),
  title: z.string().min(1),
  body: z.string().min(1),
  actions: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        style: z.enum(["primary", "danger", "default"]).optional()
      })
    )
    .optional(),
  taskId: z.string().optional(),
  confirmationId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
});

const incomingSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().min(1),
  senderNick: z.string().optional(),
  text: z.string().min(1),
  attachments: z
    .array(
      z.object({
        type: z.enum(["image", "audio", "file"]),
        url: z.string().optional(),
        downloadCode: z.string().optional(),
        mediaId: z.string().optional(),
        name: z.string().optional()
      })
    )
    .optional(),
  sessionKey: z.string().optional(),
  conversationType: z.enum(["direct", "group", "thread"]).optional(),
  threadId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  receivedAt: z.string().optional(),
  raw: z.unknown().optional()
});

const taskSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().optional(),
  project: z.string().optional(),
  sourceChannel: channelSchema.optional()
});

const confirmationSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  taskId: z.string().optional(),
  requestedBy: z.enum(["codex", "script", "automation", "user"]).default("automation"),
  priority: prioritySchema.default("P1")
});

const conversationSummarySchema = z.object({
  title: z.string().min(1).optional(),
  project: z.string().optional(),
  status: z.enum(["completed", "failed", "blocked"]).default("completed"),
  summary: z.string().min(1),
  decisions: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  next_actions: z.array(z.string()).optional(),
  needsDecision: z.boolean().default(false),
  needs_decision: z.boolean().optional(),
  highRisk: z.boolean().default(false),
  high_risk: z.boolean().optional(),
  source: z.enum(["codex", "automation", "user"]).default("codex"),
  channel: z.enum(["feishu", "lark", "dingtalk"]).optional(),
  context: z.record(z.unknown()).optional()
});

export function createHubServer(options: {
  store: JsonStore;
  dingtalkNotifyUrl: string;
  larkNotifyUrl: string;
  codexCliPath: string;
  codexCliArgsPrefix?: string[];
  intentModel?: string;
  intentReasoningEffort?: string;
  intentTimeoutMs: number;
  incomingDebounceMs?: number;
  memoryRoot: string;
  memoryDailyReportEnabled?: boolean;
  memoryDailyReportHour?: number;
  memoryOwnerSenderId?: string;
  assistantStylePrompt?: string;
  codexStateRoot?: string;
  workspaceRoot: string;
  chatEnabled?: boolean;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  openAiTimeoutMs?: number;
  openAiMaxRetries?: number;
  openAiUserAgent?: string;
  openAiExtraHeaders?: Record<string, string>;
  audioTranscriptionCommand?: string[];
  feishuReadCommand?: string[];
  feishuSheetReadCommand?: string[];
  feishuAppId?: string;
  feishuAppSecret?: string;
}) {
  const app = express();
  app.use(express.json({ limit: "512kb" }));
  const debouncer = new IncomingDebouncer(options.incomingDebounceMs ?? 1200);
  if (options.memoryDailyReportEnabled ?? true) {
    scheduleDailyMemoryReport({
      memoryRoot: options.memoryRoot,
      dingtalkNotifyUrl: options.dingtalkNotifyUrl,
      reportHour: options.memoryDailyReportHour ?? 21
    });
  }

  app.post("/envelopes", async (req, res, next) => {
    try {
      const payload = envelopeSchema.parse(req.body);
      const { hub, save } = await loadHub(options);
      const envelope = await hub.emitEnvelope(payload);
      await save();
      res.json({ ok: true, envelope, deliveryAttempts: hub.getState().deliveryAttempts.filter((item) => item.envelopeId === envelope.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/incoming/:channel", async (req, res, next) => {
    try {
      const channel = channelSchema.parse(req.params.channel);
      const payload = incomingSchema.parse(req.body);
      const envelope = await debouncer.enqueue({
        channel,
        message: {
        ...payload,
        channel,
        receivedAt: payload.receivedAt ?? new Date().toISOString()
        },
        process: async (message) => {
          const { hub, save } = await loadHub(options);
          const result = await hub.handleIncoming(message);
          await save();
          return result;
        }
      });
      res.json({ ok: true, envelope });
    } catch (error) {
      next(error);
    }
  });

  app.post("/tasks", async (req, res, next) => {
    try {
      const payload = taskSchema.parse(req.body);
      const { hub, save } = await loadHub(options);
      const task = hub.createTask(payload);
      await save();
      res.json({ ok: true, task });
    } catch (error) {
      next(error);
    }
  });

  app.post("/confirmations", async (req, res, next) => {
    try {
      const payload = confirmationSchema.parse(req.body);
      const { hub, save } = await loadHub(options);
      const envelope = await hub.createConfirmation(payload);
      await save();
      res.json({ ok: true, envelope });
    } catch (error) {
      next(error);
    }
  });

  app.post("/conversation-summaries", async (req, res, next) => {
    try {
      const payload = parseConversationSummaryPayload(req.body);
      const { hub, save } = await loadHub(options);
      const envelope = await hub.syncConversationSummary(payload);
      await save();
      res.json({
        ok: true,
        envelope,
        summary: hub.getState().conversationSummaries.find((item) => item.envelopeId === envelope.id),
        deliveryAttempts: hub.getState().deliveryAttempts.filter((item) => item.envelopeId === envelope.id)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/status", async (_req, res, next) => {
    try {
      const { hub } = await loadHub(options);
      res.type("text/plain").send(hub.formatStatus());
    } catch (error) {
      next(error);
    }
  });

  app.get("/channels/status", async (_req, res, next) => {
    try {
      const { hub } = await loadHub(options);
      res.json({
        ok: true,
        hub: "online",
        codex: options.codexCliPath ? "configured" : "missing",
        incomingDebounceMs: options.incomingDebounceMs ?? 1200,
        pendingConfirmations: hub.getState().confirmations.filter((item) => item.status === "pending").length,
        capabilities: defaultChannelCapabilities
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/confirmations/pending", async (_req, res, next) => {
    try {
      const state = await options.store.load();
      res.json({ ok: true, confirmations: state.confirmations.filter((item) => item.status === "pending") });
    } catch (error) {
      next(error);
    }
  });

  app.get("/state", async (_req, res, next) => {
    try {
      res.json(await options.store.load());
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  });

  return app;
}

function scheduleDailyMemoryReport(options: { memoryRoot: string; dingtalkNotifyUrl: string; reportHour: number }): void {
  const provider = new FileMemoryContextProvider(options.memoryRoot);
  let lastSentDate = "";
  const markerPath = join(options.memoryRoot, "pending", "daily-memory-report-sent.json");
  const tick = async () => {
    const now = new Date();
    const localDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    const localHour = Number(now.toLocaleTimeString("en-US", { timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit" }));
    if (!lastSentDate) lastSentDate = await readLastSentDate(markerPath);
    if (localHour !== options.reportHour || lastSentDate === localDate) return;
    const report = await provider.buildDailyReport?.();
    if (!report) return;
    lastSentDate = localDate;
    await writeLastSentDate(markerPath, localDate);
    await fetch(options.dingtalkNotifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: report.title,
        status: "info",
        body: report.body,
        source: "channel-memory",
        actions: report.actions
      })
    }).catch((error) => {
      lastSentDate = "";
      console.error(`[channel-hub] daily memory report failed: ${(error as Error).message}`);
    });
  };
  setInterval(() => void tick(), 60 * 1000).unref();
  void tick();
}

async function readLastSentDate(path: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { date?: unknown };
    return typeof parsed.date === "string" ? parsed.date : "";
  } catch {
    return "";
  }
}

async function writeLastSentDate(path: string, date: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ date }), "utf8");
}

export function parseConversationSummaryPayload(input: unknown) {
  const payload = conversationSummarySchema.parse(input);
  const needsDecision = payload.needs_decision ?? payload.needsDecision;
  const highRisk = payload.high_risk ?? payload.highRisk;
  const nextActions = payload.next_actions ?? payload.nextActions;
  return {
    title: payload.title ?? defaultConversationSummaryTitle(payload.project, payload.status),
    project: payload.project,
    status: payload.status,
    summary: payload.summary,
    decisions: payload.decisions,
    nextActions,
    needsDecision,
    highRisk,
    source: payload.source,
    context: payload.context
  };
}

function defaultConversationSummaryTitle(project: string | undefined, status: "completed" | "failed" | "blocked"): string {
  const subject = project ? `${project} ` : "";
  if (status === "completed") return `${subject}对话收尾摘要`;
  if (status === "failed") return `${subject}失败摘要`;
  return `${subject}阻塞摘要`;
}

async function loadHub(options: {
  store: JsonStore;
  dingtalkNotifyUrl: string;
  larkNotifyUrl: string;
  codexCliPath: string;
  codexCliArgsPrefix?: string[];
  intentModel?: string;
  intentReasoningEffort?: string;
  intentTimeoutMs: number;
  incomingDebounceMs?: number;
  memoryRoot: string;
  memoryOwnerSenderId?: string;
  assistantStylePrompt?: string;
  codexStateRoot?: string;
  workspaceRoot: string;
  chatEnabled?: boolean;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  openAiTimeoutMs?: number;
  openAiMaxRetries?: number;
  openAiUserAgent?: string;
  openAiExtraHeaders?: Record<string, string>;
  audioTranscriptionCommand?: string[];
  feishuReadCommand?: string[];
  feishuSheetReadCommand?: string[];
  feishuAppId?: string;
  feishuAppSecret?: string;
}): Promise<{ hub: ChannelHub; save: () => Promise<void> }> {
  const state = await options.store.load();
  const registry = new ChannelRegistry();
  registry.register(new HttpNotifyAdapter("dingtalk", options.dingtalkNotifyUrl));
  registry.register(new HttpNotifyAdapter("lark", options.larkNotifyUrl));
  const fallback = new RuleBasedIntentInterpreter();
  const openAiIntentProvider =
    options.openAiApiKey && options.openAiBaseUrl
      ? new OpenAiIntentProvider({
          apiKey: options.openAiApiKey,
          baseUrl: options.openAiBaseUrl,
          model: options.intentModel || options.openAiModel || "gpt-5.5",
          timeoutMs: Math.min(options.intentTimeoutMs, options.openAiTimeoutMs ?? options.intentTimeoutMs),
          maxRetries: options.openAiMaxRetries ?? 1,
          userAgent: options.openAiUserAgent,
          extraHeaders: options.openAiExtraHeaders
        })
      : undefined;
  const interpreter = new CodexIntentInterpreter({
    codexCliPath: options.codexCliPath,
    codexCliArgsPrefix: options.codexCliArgsPrefix ?? [],
    model: options.intentModel,
    reasoningEffort: options.intentReasoningEffort,
    timeoutMs: options.intentTimeoutMs,
    cwd: process.cwd(),
    codexStateRoot: options.codexStateRoot,
    fallback,
    intentProvider: openAiIntentProvider ? (input) => openAiIntentProvider.provide(input) : undefined
  });
  const memoryProvider = new FileMemoryContextProvider(options.memoryRoot);
  const chatResponder =
    options.chatEnabled && options.openAiApiKey && options.openAiBaseUrl
      ? new OpenAiChatResponder({
          apiKey: options.openAiApiKey,
          baseUrl: options.openAiBaseUrl,
          model: options.openAiModel ?? "gpt-5.5",
          timeoutMs: options.openAiTimeoutMs ?? 60000,
          maxRetries: options.openAiMaxRetries ?? 1,
          userAgent: options.openAiUserAgent,
          extraHeaders: options.openAiExtraHeaders,
          stylePrompt: options.assistantStylePrompt,
          memory: memoryProvider,
          memoryOwnerSenderId: options.memoryOwnerSenderId,
          audioTranscriptionCommand: options.audioTranscriptionCommand
        })
      : undefined;
  const hub = new ChannelHub({
    state,
    registry,
    interpreter,
    chatResponder,
    memoryRecorder: memoryProvider,
    privilegedSenderId: options.memoryOwnerSenderId,
    codexConfigured: Boolean(options.codexCliPath),
    incomingDebounceMs: options.incomingDebounceMs ?? 1200,
    projectContext: new LocalProjectContext(options.workspaceRoot),
    feishuSheetReadCommand: options.feishuSheetReadCommand,
    feishuDocumentAnalysis: {
      readCommand: options.feishuReadCommand,
      appId: options.feishuAppId,
      appSecret: options.feishuAppSecret,
      openAiApiKey: options.openAiApiKey,
      openAiBaseUrl: options.openAiBaseUrl,
      openAiModel: options.openAiModel,
      openAiTimeoutMs: options.openAiTimeoutMs,
      openAiMaxRetries: options.openAiMaxRetries,
      openAiUserAgent: options.openAiUserAgent,
      openAiExtraHeaders: options.openAiExtraHeaders
    }
  });
  return {
    hub,
    save: () => options.store.save(hub.getState())
  };
}

class IncomingDebouncer {
  private readonly batches = new Map<
    string,
    {
      messages: IncomingChannelMessage[];
      timer?: NodeJS.Timeout;
      resolve: (value: ChannelEnvelope | undefined) => void;
      reject: (reason?: unknown) => void;
      process: (message: IncomingChannelMessage) => Promise<ChannelEnvelope | undefined>;
    }
  >();

  constructor(private readonly debounceMs: number) {}

  enqueue(input: {
    channel: ChannelName;
    message: IncomingChannelMessage;
    process: (message: IncomingChannelMessage) => Promise<ChannelEnvelope | undefined>;
  }): Promise<ChannelEnvelope | undefined> {
    if (this.debounceMs <= 0) return input.process(input.message);
    const key = input.message.sessionKey ?? `${input.channel}:direct:${input.message.senderId}`;
    const existing = this.batches.get(key);
    if (existing) {
      existing.messages.push(input.message);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => void this.flush(key), this.debounceMs);
      return new Promise((resolve, reject) => {
        const previousResolve = existing.resolve;
        const previousReject = existing.reject;
        existing.resolve = (value) => {
          previousResolve(value);
          resolve(value);
        };
        existing.reject = (reason) => {
          previousReject(reason);
          reject(reason);
        };
      });
    }

    return new Promise((resolve, reject) => {
      this.batches.set(key, {
        messages: [input.message],
        process: input.process,
        resolve,
        reject,
        timer: setTimeout(() => void this.flush(key), this.debounceMs)
      });
    });
  }

  private async flush(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) return;
    this.batches.delete(key);
    const [first, ...rest] = batch.messages;
    const merged: IncomingChannelMessage = {
      ...first,
      id: batch.messages.map((message) => message.id).join("+"),
      text: [first.text, ...rest.map((message) => message.text)].join("\n"),
      attachments: batch.messages.flatMap((message) => message.attachments ?? []),
      raw: batch.messages.map((message) => message.raw ?? message)
    };
    try {
      batch.resolve(await batch.process(merged));
    } catch (error) {
      batch.reject(error);
    }
  }
}
