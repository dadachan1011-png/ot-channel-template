import { describe, expect, it, vi } from "vitest";
import type { LarkMessageEvent } from "../src/domain.js";
import { acknowledgeAndForwardToHub, handleIncomingMessage, type MessageHandlerContext } from "../src/app.js";
import { TaskManager } from "../src/tasks/taskManager.js";

function event(content: string, senderId = "ou_me"): LarkMessageEvent {
  return {
    eventId: "e",
    messageId: "om",
    chatId: "oc",
    chatType: "p2p",
    senderId,
    content,
    messageType: "text",
    createTime: "1"
  };
}

function context(manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active")) {
  const runner = {
    runTask: vi.fn(),
    cancelCurrent: vi.fn().mockReturnValue(true),
    getCurrentTaskId: vi.fn()
  };
  const ctx: MessageHandlerContext = {
    allowedOpenId: "ou_me",
    defaultCwd: "E:\\Projects\\active\\channel\\lark",
    progressMinIntervalMs: 15000,
    manager,
    runner,
    saveState: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(20000)
  };
  return { ctx, runner };
}

describe("handleIncomingMessage", () => {
  it("ignores non-allowed sender", async () => {
    const { ctx } = context();

    await handleIncomingMessage({ event: event("/ping", "ou_other"), context: ctx });

    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("replies pong to allowed sender", async () => {
    const { ctx } = context();

    await handleIncomingMessage({ event: event("/ping"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", "pong");
  });

  it("formats status", async () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "work",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\lark",
            status: "running",
            createdAt: "now",
            updatedAt: "now",
            lastProgress: "正在分析项目"
          }
        ],
        confirmations: [
          {
            id: "c_1",
            title: "是否继续",
            reason: "需要确认",
            suggestedAction: "yes",
            status: "open",
            createdAt: "now",
            updatedAt: "now"
          }
        ],
        notifications: []
      },
      "E:\\Projects\\active"
    );
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("/status"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("1. work"));
    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("最近：正在分析项目"));
    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("1. 是否继续"));
  });

  it("formats targeted status", async () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "Mail",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\lark",
            status: "running",
            createdAt: "now",
            updatedAt: "now",
            lastProgress: "正在处理邮件"
          }
        ],
        confirmations: [],
        notifications: []
      },
      "E:\\Projects\\active"
    );
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("/status Mail"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("任务：Mail"));
    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("最近：正在处理邮件"));
  });

  it("replies help for unknown text", async () => {
    const { ctx } = context();

    await handleIncomingMessage({ event: event("hello"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("我没理解：hello"));
    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("通用说法："));
  });

  it("replies contextual help for unknown text", async () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "Mail",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\lark",
            status: "running",
            createdAt: "now",
            updatedAt: "now"
          }
        ],
        confirmations: [
          {
            id: "c_1",
            title: "是否继续",
            reason: "需要确认",
            suggestedAction: "yes",
            status: "open",
            createdAt: "now",
            updatedAt: "now"
          }
        ],
        notifications: []
      },
      "E:\\Projects\\active"
    );
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("随便说一句"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("当前任务："));
    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("当前待确认："));
    expect(ctx.reply).toHaveBeenCalledWith("om", expect.stringContaining("查看 Mail"));
  });

  it("starts codex task", async () => {
    const { ctx, runner } = context();

    await handleIncomingMessage({ event: event("/codex 调研项目"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", "已创建任务：调研项目");
    expect(runner.runTask).toHaveBeenCalledOnce();
  });

  it("cancels task", async () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "work",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\lark",
            status: "running",
            createdAt: "now",
            updatedAt: "now"
          }
        ],
        confirmations: [],
        notifications: []
      },
      "E:\\Projects\\active"
    );
    const { ctx, runner } = context(manager);

    await handleIncomingMessage({ event: event("/cancel task_1"), context: ctx });

    expect(runner.cancelCurrent).toHaveBeenCalledWith("task_1");
    expect(ctx.reply).toHaveBeenCalledWith("om", "已取消任务：work");
  });

  it("cancels current task without task id", async () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "work",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\lark",
            status: "running",
            createdAt: "now",
            updatedAt: "now"
          }
        ],
        confirmations: [],
        notifications: []
      },
      "E:\\Projects\\active"
    );
    const { ctx, runner } = context(manager);

    await handleIncomingMessage({ event: event("/cancel"), context: ctx });

    expect(runner.cancelCurrent).toHaveBeenCalledWith("task_1");
    expect(ctx.reply).toHaveBeenCalledWith("om", "已取消任务：work");
  });

  it("reports no current task for cancel without task id", async () => {
    const { ctx } = context();

    await handleIncomingMessage({ event: event("/cancel"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", "当前没有可取消的任务。");
  });

  it("handles confirmation yes/no", async () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");
    const item = manager.createConfirmation({
      title: "是否继续",
      reason: "需要确认",
      suggestedAction: "yes"
    });
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event(`/confirm ${item.id} yes`), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", `确认项已同意：${item.title}`);
  });

  it("handles latest confirmation yes/no without confirmation id", async () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");
    const item = manager.createConfirmation({
      title: "是否继续",
      reason: "需要确认",
      suggestedAction: "yes"
    });
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("/confirm yes"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", `确认项已同意：${item.title}`);
  });

  it("handles confirmation reply", async () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");
    const item = manager.createConfirmation({
      title: "是否继续",
      reason: "需要确认",
      suggestedAction: "yes"
    });
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event(`/reply ${item.id} 只允许改项目配置`), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", `已记录回复：${item.title}`);
  });

  it("handles latest confirmation reply without confirmation id", async () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");
    const item = manager.createConfirmation({
      title: "是否继续",
      reason: "需要确认",
      suggestedAction: "yes"
    });
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("/reply 只允许改项目配置"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", `已记录回复：${item.title}`);
  });

  it("cancels by visible task index", async () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "lark桥接优化",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\lark",
            status: "running",
            createdAt: "now",
            updatedAt: "now"
          }
        ],
        confirmations: [],
        notifications: []
      },
      "E:\\Projects\\active"
    );
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("取消 1"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", "已取消任务：lark桥接优化");
  });

  it("approves by visible confirmation index", async () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");
    const item = manager.createConfirmation({
      title: "是否继续",
      reason: "需要确认",
      suggestedAction: "yes"
    });
    const { ctx } = context(manager);

    await handleIncomingMessage({ event: event("同意 1"), context: ctx });

    expect(ctx.reply).toHaveBeenCalledWith("om", `确认项已同意：${item.title}`);
  });
});

describe("acknowledgeAndForwardToHub", () => {
  it("replies ack before forwarding the message to Hub", async () => {
    const calls: string[] = [];
    const incoming = event("帮我看下状态");

    await acknowledgeAndForwardToHub({
      event: incoming,
      ackEnabled: true,
      ackEmoji: "👀",
      reply: vi.fn(async (messageId, text) => {
        calls.push(`reply:${messageId}:${text}`);
      }),
      forwardIncoming: vi.fn(async (forwarded) => {
        calls.push(`forward:${forwarded.messageId}`);
        return undefined;
      })
    });

    expect(calls).toEqual(["reply:om:👀", "forward:om"]);
  });

  it("still forwards when ack is disabled", async () => {
    const reply = vi.fn();
    const forwardIncoming = vi.fn().mockResolvedValue(undefined);

    await acknowledgeAndForwardToHub({
      event: event("帮我看下状态"),
      ackEnabled: false,
      ackEmoji: "👀",
      reply,
      forwardIncoming
    });

    expect(reply).not.toHaveBeenCalled();
    expect(forwardIncoming).toHaveBeenCalledOnce();
  });

  it("replies with the Hub result in the original conversation", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await acknowledgeAndForwardToHub({
      event: event("knowledge-base 运行的怎么样了"),
      ackEnabled: false,
      ackEmoji: "👀",
      reply,
      forwardIncoming: vi.fn().mockResolvedValue({
        title: "当前状态",
        body: "项目：knowledge-base\n状态：completed"
      })
    });

    expect(reply).toHaveBeenCalledWith("om", "当前状态\n\n项目：knowledge-base\n状态：completed");
  });
});
