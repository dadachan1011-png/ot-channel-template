import type { Server } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfigFromEnv } from "./config.js";
import { parseCommand } from "./commands/parser.js";
import type { BridgeState, BridgeTask, ChannelMessageEvent } from "./domain.js";
import { DingTalkClient } from "./dingtalk/dingtalkClient.js";
import { startEventConsumer } from "./dingtalk/eventConsumer.js";
import { HubClient } from "./hub/hubClient.js";
import { createNotifyServer } from "./notify/server.js";
import type { HubIncomingEnvelope } from "./hub/hubClient.js";
import { JsonStore } from "./store/jsonStore.js";
import { CodexRunner } from "./tasks/codexRunner.js";
import { TaskManager } from "./tasks/taskManager.js";

export type MessageHandlerContext = {
  allowedSenderStaffId: string;
  defaultCwd: string;
  progressMinIntervalMs: number;
  sendProgressUpdates?: boolean;
  manager: TaskManager;
  runner: Pick<CodexRunner, "runTask" | "cancelCurrent" | "getCurrentTaskId">;
  saveState: () => Promise<void>;
  reply: (messageId: string, text: string) => Promise<void>;
  replyActionCard?: (messageId: string, input: { title: string; text: string; actions: Array<{ label: string; value: string; style?: "primary" | "danger" | "default" }> }) => Promise<void>;
  sendText: (conversationId: string, text: string) => Promise<void>;
  now?: () => number;
};

export async function handleIncomingMessage(options: {
  event: ChannelMessageEvent;
  context: MessageHandlerContext;
}): Promise<void> {
  const { event, context } = options;
  if (event.senderStaffId !== context.allowedSenderStaffId) return;

  const command = parseCommand(event.content);

  try {
    if (command.kind === "ping") {
      await context.reply(event.messageId, "pong");
      return;
    }

    if (command.kind === "status") {
      await context.reply(event.messageId, command.target ? context.manager.formatTargetStatus(command.target) : context.manager.formatStatus());
      return;
    }

    if (command.kind === "codex") {
      const task = context.manager.createCodexTask(command.prompt, context.defaultCwd, {
        conversationId: event.conversationId,
        messageId: event.messageId,
        name: command.name
      });
      context.manager.updateTask(task.id, { status: "running" });
      await context.saveState();
      await context.reply(event.messageId, `已创建任务：${task.name}`);
      startCodexTask(task, context);
      return;
    }

    if (command.kind === "cancel") {
      const task = context.manager.findTaskByTarget(command.target);
      if (!task) {
        await context.reply(event.messageId, "当前没有可取消的任务。");
        return;
      }

      context.manager.cancelTask(task.id);
      const stopped = context.runner.cancelCurrent(task.id);
      await context.saveState();
      await context.reply(event.messageId, stopped ? `已取消任务：${task.name}` : `任务已标记取消：${task.name}`);
      return;
    }

    if (command.kind === "confirm") {
      const confirmation = context.manager.findConfirmationByTarget(command.target);
      if (!confirmation) {
        await context.reply(event.messageId, "当前没有待确认事项。");
        return;
      }

      const approved = command.answer === "yes";
      const item = context.manager.answerConfirmation(confirmation.id, command.answer, approved);
      await context.saveState();
      await context.reply(event.messageId, `确认项已${approved ? "同意" : "拒绝"}：${item.title}`);
      return;
    }

    if (command.kind === "reply") {
      const confirmation = context.manager.findConfirmationByTarget(command.target);
      if (!confirmation) {
        await context.reply(event.messageId, "当前没有可补充说明的待确认事项。");
        return;
      }

      const item = context.manager.replyConfirmation(confirmation.id, command.text);
      await context.saveState();
      await context.reply(event.messageId, `已记录回复：${item.title}`);
      return;
    }

    if (command.kind === "unknown") {
      await context.reply(event.messageId, context.manager.formatHelp(command.raw));
      return;
    }
  } catch (error) {
    await context.reply(event.messageId, `处理失败：${(error as Error).message}`);
  }
}

export async function acknowledgeAndForwardToHub(options: {
  event: ChannelMessageEvent;
  ackEnabled: boolean;
  ackEmoji: string;
  typingEnabled?: boolean;
  typingAfterMs?: number;
  longTypingAfterMs?: number;
  typingText?: string;
  longTypingText?: string;
  reply: (messageId: string, text: string) => Promise<void>;
  replyActionCard?: (messageId: string, input: { title: string; text: string; actions: Array<{ label: string; value: string; style?: "primary" | "danger" | "default" }> }) => Promise<void>;
  forwardIncoming: (event: ChannelMessageEvent) => Promise<HubIncomingEnvelope | undefined>;
  startHubTask?: (event: ChannelMessageEvent, envelope: HubIncomingEnvelope) => Promise<boolean>;
  handleLocalQuery?: (event: ChannelMessageEvent) => Promise<boolean>;
}): Promise<void> {
  const { event, ackEnabled, ackEmoji, reply, forwardIncoming } = options;
  const timers: NodeJS.Timeout[] = [];
  if (ackEnabled) {
    await reply(event.messageId, ackEmoji).catch((error) => {
      console.error(`[ack] failed: ${(error as Error).message}`);
    });
  }
  if (options.typingEnabled) {
    timers.push(
      setTimeout(() => {
        void reply(event.messageId, options.typingText ?? "处理中：正在判断你的意图").catch((error) => {
          console.error(`[typing] failed: ${(error as Error).message}`);
        });
      }, options.typingAfterMs ?? 5000)
    );
    timers.push(
      setTimeout(() => {
        void reply(event.messageId, options.longTypingText ?? "还在处理：已进入深度判断").catch((error) => {
          console.error(`[typing] failed: ${(error as Error).message}`);
        });
      }, options.longTypingAfterMs ?? 30000)
    );
  }
  try {
    if (options.handleLocalQuery && (await options.handleLocalQuery(event))) return;
    const envelope = await forwardIncoming(event);
    if (envelope) {
      if (options.startHubTask && isHubTaskEnvelope(envelope)) {
        try {
          if (await options.startHubTask(event, envelope)) return;
        } catch (error) {
          await reply(event.messageId, `Codex 任务启动失败：${(error as Error).message}`);
          return;
        }
      }
      await replyWithEnvelope(event.messageId, envelope, { reply, replyActionCard: options.replyActionCard });
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
}

function formatHubReply(envelope: HubIncomingEnvelope): string {
  if (shouldHideReplyTitle(envelope)) return envelope.body;
  if (envelope.title === envelope.body) return envelope.body;
  return `${envelope.title}\n\n${envelope.body}`;
}

function shouldHideReplyTitle(envelope: HubIncomingEnvelope): boolean {
  return envelope.type === "chat" && envelope.priority === "P2" && envelope.metadata?.directReplyOnly === true;
}

async function replyWithEnvelope(
  messageId: string,
  envelope: HubIncomingEnvelope,
  options: {
    reply: (messageId: string, text: string) => Promise<void>;
    replyActionCard?: (messageId: string, input: { title: string; text: string; actions: Array<{ label: string; value: string; style?: "primary" | "danger" | "default" }> }) => Promise<void>;
  }
): Promise<void> {
  if (envelope.actions && envelope.actions.length > 0 && options.replyActionCard) {
    await options.replyActionCard(messageId, {
      title: envelope.title,
      text: envelope.body,
      actions: envelope.actions
    });
    return;
  }
  await options.reply(messageId, formatHubReply(envelope));
}

function isHubTaskEnvelope(envelope: HubIncomingEnvelope): boolean {
  return envelope.type === "task" && typeof envelope.metadata?.codexPrompt === "string";
}

export async function handleLightweightLocalQuery(options: {
  event: ChannelMessageEvent;
  workspaceRoot: string;
  loadBridgeState?: () => Promise<BridgeState>;
  reply: (messageId: string, text: string) => Promise<void>;
}): Promise<boolean> {
  if (isRunningTaskListQuery(options.event.content) && options.loadBridgeState) {
    const state = await options.loadBridgeState();
    await options.reply(options.event.messageId, formatRunningTasks(state.tasks));
    return true;
  }

  if (isRecentTaskQuery(options.event.content) && options.loadBridgeState) {
    const state = await options.loadBridgeState();
    await options.reply(options.event.messageId, formatRecentTasks(state.tasks));
    return true;
  }

  if (isFailedTaskQuery(options.event.content) && options.loadBridgeState) {
    const state = await options.loadBridgeState();
    await options.reply(options.event.messageId, formatTasksByStatus(state.tasks, "failed"));
    return true;
  }

  if (isCompletedTaskQuery(options.event.content) && options.loadBridgeState) {
    const state = await options.loadBridgeState();
    await options.reply(options.event.messageId, formatTasksByStatus(state.tasks, "completed"));
    return true;
  }

  if (!isFastProjectListQuery(options.event.content) && !isProjectListQuery(options.event.content)) return false;
  const projects = await listWorkspaceProjects(options.workspaceRoot);
  await options.reply(options.event.messageId, formatWorkspaceProjects(projects, options.workspaceRoot));
  return true;
}

function isFastProjectListQuery(input: string): boolean {
  const compact = normalizeForLightweightMatch(input);
  if (!/(codex|project)/i.test(compact) && !compact.includes("项目")) return false;
  if (/(eta|任务|进度|风险|分析|评估|完成|多久|预估|预计)/i.test(compact)) return false;
  return /(projects?|项目列表|列出项目|有什么项目|有哪些项目|几个项目|多少项目|项目名称|项目名字|查项目|看项目)/i.test(compact);
}

function isRunningTaskListQuery(input: string): boolean {
  const compact = normalizeForLightweightMatch(input);
  if (!/(codex|task)/i.test(compact) && !compact.includes("任务")) return false;
  if (/(多久|预估|预计|eta|完成时间|还要|剩余|分析|评估|风险|为什么|原因)/i.test(compact)) return false;
  return /(在跑|正在跑|运行中|当前任务|任务状态|跑的任务|runningtasks?|activetasks?)/i.test(compact);
}

function isRecentTaskQuery(input: string): boolean {
  const compact = normalizeForLightweightMatch(input);
  if (!/(codex|task)/i.test(compact) && !compact.includes("任务")) return false;
  return /(最近任务|历史任务|任务历史|recenttasks?|taskhistory)/i.test(compact);
}

function isFailedTaskQuery(input: string): boolean {
  const compact = normalizeForLightweightMatch(input);
  if (!/(codex|task)/i.test(compact) && !compact.includes("任务")) return false;
  return /(失败任务|失败的任务|最近失败|failedtasks?)/i.test(compact);
}

function isCompletedTaskQuery(input: string): boolean {
  const compact = normalizeForLightweightMatch(input);
  if (!/(codex|task)/i.test(compact) && !compact.includes("任务")) return false;
  return /(完成任务|已完成任务|最近完成|completedtasks?)/i.test(compact);
}

function normalizeForLightweightMatch(input: string): string {
  return input.replace(/\s+/g, "").replace(/[，。！？、；：,.!?;:]/g, "").toLowerCase();
}

function isProjectListQuery(input: string): boolean {
  const compact = input.replace(/\s+/g, "").toLowerCase();
  if (!/(codex|项目|project)/i.test(compact)) return false;
  if (/(多久|预估|预计|eta|完成|进度|分析|评估|风险|任务)/i.test(compact)) return false;
  return /(有什么项目|有哪些项目|项目列表|列出项目|几个项目|多少项目|项目名称|项目名字|查项目|看项目)/i.test(compact);
}

async function listWorkspaceProjects(workspaceRoot: string): Promise<Array<{ name: string; markers: string[] }>> {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

  return Promise.all(
    directories.map(async (name) => ({
      name,
      markers: await findProjectMarkers(join(workspaceRoot, name))
    }))
  );
}

async function findProjectMarkers(dir: string): Promise<string[]> {
  const candidates = [".git", "package.json", "pyproject.toml", "README.md", "readme.md", "pnpm-workspace.yaml", "projects.yml"];
  const markers: string[] = [];
  for (const candidate of candidates) {
    try {
      await access(join(dir, candidate));
      markers.push(candidate);
    } catch {
      // Missing markers are fine; this is a lightweight directory scan.
    }
  }
  return markers;
}

function formatWorkspaceProjects(projects: Array<{ name: string; markers: string[] }>, workspaceRoot: string): string {
  const lines = [`查到了，${workspaceRoot} 下当前可见 ${projects.length} 个一级目录：`, ""];
  for (const project of projects) {
    const markerText = project.markers.length > 0 ? `（${project.markers.slice(0, 3).join(", ")}）` : "";
    lines.push(`- ${project.name}${markerText}`);
  }
  lines.push("", "这是轻量只读扫描；需要评估进度、风险或 ETA 时我再交给 Codex。");
  return lines.join("\n");
}

function formatRunningTasks(tasks: BridgeTask[]): string {
  const activeTasks = tasks.filter((task) => ["queued", "running", "waiting_confirmation"].includes(task.status));
  if (activeTasks.length === 0) return "当前没有 bridge 确认在跑的 Codex 任务。";

  const lines = [`当前 bridge 确认在跑的 Codex 任务有 ${activeTasks.length} 个：`, ""];
  for (const task of activeTasks) {
    lines.push(`- ${task.id}: ${task.name}`);
    lines.push(`  状态：${task.status}`);
    lines.push(`  创建：${formatLocalTime(task.createdAt)}`);
    lines.push(`  更新：${formatLocalTime(task.updatedAt)}`);
    if (task.lastProgress) lines.push(`  最近：${task.lastProgress}`);
  }
  lines.push("", "这是 bridge 本地状态秒查；如果要评估每个任务还要多久，我再交给 Codex 分析。");
  return lines.join("\n");
}

function formatRecentTasks(tasks: BridgeTask[]): string {
  const recent = [...tasks].sort(compareTaskUpdatedDesc).slice(0, 8);
  if (recent.length === 0) return "还没有 bridge 记录的 Codex 任务。";
  return formatTaskList(`最近 ${recent.length} 个 bridge Codex 任务：`, recent);
}

function formatTasksByStatus(tasks: BridgeTask[], status: BridgeTask["status"]): string {
  const matched = tasks.filter((task) => task.status === status).sort(compareTaskUpdatedDesc).slice(0, 8);
  if (matched.length === 0) return `最近没有 ${status} 的 bridge Codex 任务。`;
  return formatTaskList(`最近 ${matched.length} 个 ${status} 的 bridge Codex 任务：`, matched);
}

function formatTaskList(title: string, tasks: BridgeTask[]): string {
  const lines = [title, ""];
  for (const task of tasks) {
    lines.push(`- ${task.id}: ${task.name}`);
    lines.push(`  状态：${task.status}`);
    lines.push(`  更新：${formatLocalTime(task.updatedAt)}`);
    if (task.reasoningEffort) lines.push(`  推理：${task.reasoningEffort}`);
    if (task.error) lines.push(`  错误：${task.error}`);
    if (task.finalMessage) lines.push(`  结果：${task.finalMessage.slice(0, 120)}`);
  }
  return lines.join("\n");
}

function compareTaskUpdatedDesc(left: BridgeTask, right: BridgeTask): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function formatLocalTime(input: string): string {
  const time = new Date(input);
  if (Number.isNaN(time.getTime())) return input;
  return time.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function startCodexTask(task: BridgeTask, context: MessageHandlerContext): void {
  let lastSentAt = 0;
  const now = context.now ?? Date.now;

  context.runner.runTask({
    task,
    onProgress: async (text) => {
      context.manager.updateTask(task.id, { status: "running", lastProgress: text });
      await context.saveState();

      const currentTime = now();
      if (context.sendProgressUpdates && currentTime - lastSentAt >= context.progressMinIntervalMs) {
        lastSentAt = currentTime;
        if (task.channelConversationId) await context.sendText(task.channelConversationId, `任务进度 ${task.name}：\n${text}`);
      }
    },
    onComplete: async (text) => {
      context.manager.updateTask(task.id, { status: "completed", finalMessage: text });
      await context.saveState();
      if (task.channelConversationId) await context.sendText(task.channelConversationId, formatCodexCompletion(task.name, text));
    },
    onFailure: async (error) => {
      context.manager.updateTask(task.id, { status: "failed", error: error.message });
      await context.saveState();
      if (task.channelConversationId) await context.sendText(task.channelConversationId, `任务失败 ${task.name}：\n${error.message}`);
    }
  });
}

function formatCodexCompletion(taskName: string, text: string): string {
  const cleaned = stripNoisyMarkdown(text).trim();
  const failed = /(无法|不能|没有查到|没查到|未找到|缺少|不足|失败|报错|卡住|blocked|failed)/i.test(cleaned);
  const prefix = failed ? `${taskName}：没查全` : `${taskName}：已完成`;
  const body = compactForDingTalk(cleaned, 900);
  return `${prefix}\n${body}`;
}

function stripNoisyMarkdown(input: string): string {
  return input
    .replace(/```(?:text|markdown|md)?\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*\|[-:\s|]+\|\s*$/gm, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

function compactForDingTalk(input: string, maxChars: number): string {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^已检查范围[:：]?$/.test(line))
    .filter((line) => !/^已定位到的 BI 入口[:：]?$/.test(line));
  const kept: string[] = [];
  for (const line of lines) {
    const next = [...kept, line].join("\n");
    if (next.length > maxChars) break;
    kept.push(line);
    if (kept.length >= 8) break;
  }
  const output = kept.join("\n").trim();
  if (!output) return "没有拿到可读结果。";
  return output.length <= maxChars ? output : `${output.slice(0, maxChars - 20)}\n...后面已省略`;
}

export async function startApp(): Promise<() => void> {
  const config = loadConfigFromEnv(process.env);
  const store = new JsonStore(config.stateFile);
  const dingtalk = new DingTalkClient(config.clientId, config.clientSecret, config.robotCode, config.notifyUserId);
  const hub = config.hubUrl ? new HubClient(config.hubUrl) : undefined;
  const runner = new CodexRunner(config.codexCliPath, {
    model: config.codexModel,
    reasoningEffort: config.codexReasoningEffort
  });
  const notifyApp = createNotifyServer({
    store,
    dingtalk
  });
  const server: Server = notifyApp.listen(config.notifyPort);
  const startupState = await store.load();
  const startupManager = new TaskManager(startupState, config.allowedWorkspaceRoot);
  const recoveredTasks = startupManager.recoverInterruptedActiveTasks();
  if (recoveredTasks.length > 0) {
    await store.save(startupManager.getState());
    console.log(`[bridge] recovered ${recoveredTasks.length} stale active task(s) after restart`);
  }

  const stopConsumer = startEventConsumer({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    onLog: (message) => console.log(`[bridge] ${message}`),
    onError: (error) => console.error(error),
    onEvent: async (event) => {
      dingtalk.rememberSessionWebhook(event.conversationId, event.sessionWebhook);
      dingtalk.rememberMessageWebhook(event.messageId, event.sessionWebhook);
      await ensureDingTalkBinding({ event, config, dingtalk });
      await enrichAttachmentUrls(event, dingtalk);
      const privileged = Boolean(config.allowedSenderStaffId) && event.senderStaffId === config.allowedSenderStaffId;
      console.log(
        `[bridge] incoming dingtalk message conversationType=${event.conversationType} privileged=${privileged} hub=${Boolean(hub)} messageType=${event.messageType}`
      );

      if (hub) {
        try {
          await acknowledgeAndForwardToHub({
            event,
            ackEnabled: config.ackEnabled,
            ackEmoji: config.ackEmoji,
            typingEnabled: config.typingEnabled,
            typingAfterMs: config.typingAfterMs,
            longTypingAfterMs: config.longTypingAfterMs,
            typingText: config.typingText,
            longTypingText: config.longTypingText,
            reply: (messageId, text) => dingtalk.replyText(messageId, text),
            replyActionCard: (messageId, input) => dingtalk.replyActionCard(messageId, input),
            handleLocalQuery: (incoming) =>
              handleLightweightLocalQuery({
                event: incoming,
                workspaceRoot: config.allowedWorkspaceRoot,
                loadBridgeState: () => store.load(),
                reply: (messageId, text) => dingtalk.replyText(messageId, text)
              }),
            forwardIncoming: (incoming) => hub.forwardIncoming(incoming),
            startHubTask: async (incoming, envelope) => {
              if (!privileged) {
                await dingtalk.replyText(incoming.messageId, "这个动作需要 owner 本人确认。我可以先帮你把需求整理一下 🙂");
                return true;
              }
              const prompt = envelope.metadata?.codexPrompt;
              const cwd = envelope.metadata?.cwd;
              const reasoningEffort = envelope.metadata?.reasoningEffort;
              if (typeof prompt !== "string") return false;
              const state = await store.load();
              const manager = new TaskManager(state, config.allowedWorkspaceRoot);
              const task = manager.createCodexTask(prompt, typeof cwd === "string" ? cwd : config.allowedWorkspaceRoot, {
                conversationId: incoming.conversationId,
                messageId: incoming.messageId,
                name: envelope.title.replace(/^已创建任务：/, ""),
                reasoningEffort: typeof reasoningEffort === "string" ? reasoningEffort : undefined
              });
              manager.updateTask(task.id, { status: "running" });
              await store.save(manager.getState());
              await dingtalk.replyText(incoming.messageId, `已启动 Codex 任务：${task.name}`);
              startCodexTask(task, {
                allowedSenderStaffId: config.allowedSenderStaffId,
                defaultCwd: process.cwd(),
                progressMinIntervalMs: config.progressMinIntervalMs,
                sendProgressUpdates: config.codexProgressUpdatesEnabled,
                manager,
                runner,
                saveState: () => store.save(manager.getState()),
                reply: (messageId, text) => dingtalk.replyText(messageId, text),
                replyActionCard: (messageId, input) => dingtalk.replyActionCard(messageId, input),
                sendText: (conversationId, text) => dingtalk.sendText(conversationId, text)
              });
              return true;
            }
          });
          return;
        } catch (error) {
          console.error(`[hub] forward failed, falling back to local handler: ${(error as Error).message}`);
        }
      }

      const state = await store.load();
      const manager = new TaskManager(state, config.allowedWorkspaceRoot);
      await handleIncomingMessage({
        event,
        context: {
          allowedSenderStaffId: config.allowedSenderStaffId,
          defaultCwd: process.cwd(),
          progressMinIntervalMs: config.progressMinIntervalMs,
          sendProgressUpdates: config.codexProgressUpdatesEnabled,
          manager,
          runner,
          saveState: () => store.save(manager.getState()),
          reply: (messageId, text) => dingtalk.replyText(messageId, text),
          replyActionCard: (messageId, input) => dingtalk.replyActionCard(messageId, input),
          sendText: (conversationId, text) => dingtalk.sendText(conversationId, text)
        }
      });
      await store.save(manager.getState());
    }
  });

  return () => {
    stopConsumer();
    server.close();
  };
}

async function enrichAttachmentUrls(event: ChannelMessageEvent, dingtalk: DingTalkClient): Promise<void> {
  const attachments = event.attachments ?? [];
  for (const attachment of attachments) {
    if (attachment.url || !attachment.downloadCode) continue;
    try {
      attachment.url = await dingtalk.getMessageFileDownloadUrl(attachment.downloadCode);
    } catch (error) {
      console.error(`[bridge] failed to resolve DingTalk attachment download URL: ${(error as Error).message}`);
    }
  }
}

async function ensureDingTalkBinding(options: {
  event: ChannelMessageEvent;
  config: ReturnType<typeof loadConfigFromEnv>;
  dingtalk: DingTalkClient;
}): Promise<void> {
  const updates: Record<string, string> = {};
  const robotCode = options.event.robotCode || options.config.robotCode || options.config.clientId;

  if (!options.config.robotCode && robotCode) {
    options.config.robotCode = robotCode;
    updates.DINGTALK_ROBOT_CODE = robotCode;
  }

  if (!options.config.allowedSenderStaffId && options.event.senderStaffId) {
    options.config.allowedSenderStaffId = options.event.senderStaffId;
    updates.DINGTALK_ALLOWED_SENDER_STAFF_ID = options.event.senderStaffId;
  }

  if (!options.config.notifyUserId && options.event.senderStaffId) {
    options.config.notifyUserId = options.event.senderStaffId;
    updates.DINGTALK_NOTIFY_USER_ID = options.event.senderStaffId;
  }

  options.dingtalk.updateTargets({
    robotCode: options.config.robotCode,
    notifyUserId: options.config.notifyUserId
  });

  if (Object.keys(updates).length > 0) {
    updateSharedEnv(updates);
    await options.dingtalk.replyText(options.event.messageId, "已完成钉钉身份绑定，请再发送 /ping 测试。").catch((error) => {
      console.error(`[bootstrap] binding reply failed: ${(error as Error).message}`);
    });
  }
}

function updateSharedEnv(updates: Record<string, string>): void {
  const sharedEnvPath = process.env.CHANNEL_SHARED_ENV_PATH ?? process.env.CODEXPROJECTS_ENV_PATH ?? ".env";
  const lines = existsSync(sharedEnvPath) ? readFileSync(sharedEnvPath, "utf8").split(/\r?\n/) : [];
  const remaining = new Map(Object.entries(updates).filter(([, value]) => value));
  const next = lines.map((line) => {
    const match = line.match(/^([^#=][^=]*?)=(.*)$/);
    if (!match) return line;
    const key = match[1].trim();
    const value = remaining.get(key);
    if (value === undefined) return line;
    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining) next.push(`${key}=${value}`);
  writeFileSync(sharedEnvPath, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}
