import type { Server } from "node:http";
import { loadConfigFromEnv } from "./config.js";
import { parseCommand } from "./commands/parser.js";
import type { BridgeTask, LarkMessageEvent } from "./domain.js";
import { LarkClient } from "./lark/larkClient.js";
import { startEventConsumer } from "./lark/eventConsumer.js";
import { HubClient } from "./hub/hubClient.js";
import { createNotifyServer } from "./notify/server.js";
import type { HubIncomingEnvelope } from "./hub/hubClient.js";
import { JsonStore } from "./store/jsonStore.js";
import { CodexRunner } from "./tasks/codexRunner.js";
import { TaskManager } from "./tasks/taskManager.js";

export type MessageHandlerContext = {
  allowedOpenId: string;
  defaultCwd: string;
  progressMinIntervalMs: number;
  manager: TaskManager;
  runner: Pick<CodexRunner, "runTask" | "cancelCurrent" | "getCurrentTaskId">;
  saveState: () => Promise<void>;
  reply: (messageId: string, text: string) => Promise<void>;
  sendText: (chatId: string, text: string) => Promise<void>;
  now?: () => number;
};

export async function handleIncomingMessage(options: {
  event: LarkMessageEvent;
  context: MessageHandlerContext;
}): Promise<void> {
  const { event, context } = options;
  if (event.senderId !== context.allowedOpenId) return;
  if (event.chatType !== "p2p") return;

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
        chatId: event.chatId,
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
  event: LarkMessageEvent;
  ackEnabled: boolean;
  ackEmoji: string;
  typingEnabled?: boolean;
  typingAfterMs?: number;
  longTypingAfterMs?: number;
  typingText?: string;
  longTypingText?: string;
  reply: (messageId: string, text: string) => Promise<void>;
  forwardIncoming: (event: LarkMessageEvent) => Promise<HubIncomingEnvelope | undefined>;
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
    const envelope = await forwardIncoming(event);
    if (envelope) {
      await reply(event.messageId, formatHubReply(envelope));
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
}

function formatHubReply(envelope: HubIncomingEnvelope): string {
  return `${envelope.title}\n\n${envelope.body}`;
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
      if (currentTime - lastSentAt >= context.progressMinIntervalMs) {
        lastSentAt = currentTime;
        if (task.larkChatId) await context.sendText(task.larkChatId, `任务进度 ${task.name}：\n${text}`);
      }
    },
    onComplete: async (text) => {
      context.manager.updateTask(task.id, { status: "completed", finalMessage: text });
      await context.saveState();
      if (task.larkChatId) await context.sendText(task.larkChatId, `任务完成 ${task.name}：\n${text}`);
    },
    onFailure: async (error) => {
      context.manager.updateTask(task.id, { status: "failed", error: error.message });
      await context.saveState();
      if (task.larkChatId) await context.sendText(task.larkChatId, `任务失败 ${task.name}：\n${error.message}`);
    }
  });
}

export async function startApp(): Promise<() => void> {
  const config = loadConfigFromEnv(process.env);
  const store = new JsonStore(config.stateFile);
  const lark = new LarkClient(config.larkCliPath);
  const hub = config.hubUrl ? new HubClient(config.hubUrl) : undefined;
  const runner = new CodexRunner(config.codexCliPath, {
    model: config.codexModel,
    reasoningEffort: config.codexReasoningEffort
  });
  const notifyApp = createNotifyServer({
    store,
    lark,
    notifyChatId: config.notifyChatId,
    notifyUserId: config.notifyUserId
  });
  const server: Server = notifyApp.listen(config.notifyPort);

  const stopConsumer = startEventConsumer({
    larkCliPath: config.larkCliPath,
    onError: (error) => console.error(error),
    onEvent: async (event) => {
      console.log(
        `[bridge] incoming lark message chatType=${event.chatType} authorized=${event.senderId === config.allowedOpenId} hub=${Boolean(hub)}`
      );
      if (hub && event.senderId === config.allowedOpenId && event.chatType === "p2p") {
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
            reply: (messageId, text) => lark.replyText(messageId, text),
            forwardIncoming: (incoming) => hub.forwardIncoming(incoming)
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
          allowedOpenId: config.allowedOpenId,
          defaultCwd: process.cwd(),
          progressMinIntervalMs: config.progressMinIntervalMs,
          manager,
          runner,
          saveState: () => store.save(manager.getState()),
          reply: (messageId, text) => lark.replyText(messageId, text),
          sendText: (chatId, text) => lark.sendText(chatId, text)
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
