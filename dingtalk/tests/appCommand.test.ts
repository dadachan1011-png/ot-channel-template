import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelMessageEvent } from "../src/domain.js";
import { acknowledgeAndForwardToHub, handleIncomingMessage, handleLightweightLocalQuery, type MessageHandlerContext } from "../src/app.js";
import { TaskManager } from "../src/tasks/taskManager.js";

function event(content: string, senderStaffId = "staff_me"): ChannelMessageEvent {
  return {
    eventId: "e",
    messageId: "om",
    conversationId: "cid",
    conversationType: "1",
    senderId: "sender",
    senderStaffId,
    content,
    messageType: "text",
    createTime: "1",
    sessionWebhook: "https://example.test/session"
  };
}

function context(manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active")) {
  const runner = {
    runTask: vi.fn(),
    cancelCurrent: vi.fn().mockReturnValue(true),
    getCurrentTaskId: vi.fn()
  };
  const ctx: MessageHandlerContext = {
    allowedSenderStaffId: "staff_me",
    defaultCwd: "E:\\Projects\\active\\channel\\dingtalk",
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

    await handleIncomingMessage({ event: event("/ping", "staff_other"), context: ctx });

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
            cwd: "E:\\Projects\\active\\channel\\dingtalk",
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
            cwd: "E:\\Projects\\active\\channel\\dingtalk",
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
            cwd: "E:\\Projects\\active\\channel\\dingtalk",
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
            cwd: "E:\\Projects\\active\\channel\\dingtalk",
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
            cwd: "E:\\Projects\\active\\channel\\dingtalk",
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
            name: "dingtalk桥接优化",
            prompt: "work",
            cwd: "E:\\Projects\\active\\channel\\dingtalk",
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

    expect(ctx.reply).toHaveBeenCalledWith("om", "已取消任务：dingtalk桥接优化");
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
  it("handles lightweight project list queries locally before forwarding to Hub", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-projects-"));
    try {
      await mkdir(join(root, "AI-Infrastructure"));
      await writeFile(join(root, "AI-Infrastructure", "package.json"), "{}");
      await mkdir(join(root, "New project 3"));
      const reply = vi.fn().mockResolvedValue(undefined);
      const forwardIncoming = vi.fn();

      await acknowledgeAndForwardToHub({
        event: event("帮我用codex查下现在有什么项目"),
        ackEnabled: false,
        ackEmoji: "",
        reply,
        forwardIncoming,
        handleLocalQuery: (incoming) =>
          handleLightweightLocalQuery({
            event: incoming,
            workspaceRoot: root,
            reply
          })
      });

      expect(forwardIncoming).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("AI-Infrastructure"));
      expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("New project 3"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles running task list queries locally before forwarding to Hub", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const forwardIncoming = vi.fn();

    await acknowledgeAndForwardToHub({
      event: event("帮我用codex查下现在有什么在跑的任务"),
      ackEnabled: false,
      ackEmoji: "",
      reply,
      forwardIncoming,
      handleLocalQuery: (incoming) =>
        handleLightweightLocalQuery({
          event: incoming,
          workspaceRoot: "E:\\Projects\\active",
          loadBridgeState: async () => ({
            tasks: [
              {
                id: "task_1",
                name: "检查任务",
                prompt: "check",
                cwd: "E:\\Projects\\active",
                status: "running",
                createdAt: "2026-05-18T17:00:00.000Z",
                updatedAt: "2026-05-18T17:01:00.000Z"
              }
            ],
            confirmations: [],
            notifications: []
          }),
          reply
        })
    });

    expect(forwardIncoming).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("task_1"));
    expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("检查任务"));
  });

  it("keeps ETA task questions routed to Hub for Codex analysis", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const forwardIncoming = vi.fn().mockResolvedValue(undefined);

    await acknowledgeAndForwardToHub({
      event: event("帮我用codex查下现在有什么在跑的任务，每个预估多久完成"),
      ackEnabled: false,
      ackEmoji: "",
      reply,
      forwardIncoming,
      handleLocalQuery: (incoming) =>
        handleLightweightLocalQuery({
          event: incoming,
          workspaceRoot: "E:\\Projects\\active",
          loadBridgeState: async () => ({ tasks: [], confirmations: [], notifications: [] }),
          reply
        })
    });

    expect(forwardIncoming).toHaveBeenCalledOnce();
  });

  it("handles recent and failed task queries locally", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const forwardIncoming = vi.fn();
    const loadBridgeState = async () => ({
      tasks: [
        {
          id: "task_done",
          name: "done",
          prompt: "done",
          cwd: "E:\\Projects\\active",
          status: "completed" as const,
          createdAt: "2026-05-18T17:00:00.000Z",
          updatedAt: "2026-05-18T17:02:00.000Z",
          reasoningEffort: "medium"
        },
        {
          id: "task_failed",
          name: "failed",
          prompt: "failed",
          cwd: "E:\\Projects\\active",
          status: "failed" as const,
          createdAt: "2026-05-18T17:00:00.000Z",
          updatedAt: "2026-05-18T17:03:00.000Z",
          error: "boom"
        }
      ],
      confirmations: [],
      notifications: []
    });

    await acknowledgeAndForwardToHub({
      event: event("recent tasks"),
      ackEnabled: false,
      ackEmoji: "",
      reply,
      forwardIncoming,
      handleLocalQuery: (incoming) =>
        handleLightweightLocalQuery({
          event: incoming,
          workspaceRoot: "E:\\Projects\\active",
          loadBridgeState,
          reply
        })
    });

    await acknowledgeAndForwardToHub({
      event: event("failed tasks"),
      ackEnabled: false,
      ackEmoji: "",
      reply,
      forwardIncoming,
      handleLocalQuery: (incoming) =>
        handleLightweightLocalQuery({
          event: incoming,
          workspaceRoot: "E:\\Projects\\active",
          loadBridgeState,
          reply
        })
    });

    expect(forwardIncoming).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("task_done"));
    expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("task_failed"));
    expect(reply).toHaveBeenCalledWith("om", expect.stringContaining("boom"));
  });

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

  it("hides low-priority direct chat titles from Hub replies", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await acknowledgeAndForwardToHub({
      event: event("你是谁"),
      ackEnabled: false,
      ackEmoji: "",
      reply,
      forwardIncoming: vi.fn().mockResolvedValue({
        type: "chat",
        priority: "P2",
        title: "Channel Agent",
        body: "我是你的本地 Agent 入口。",
        metadata: { directReplyOnly: true }
      })
    });

    expect(reply).toHaveBeenCalledWith("om", "我是你的本地 Agent 入口。");
  });

  it("starts a local Codex task when Hub returns a task envelope", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const startHubTask = vi.fn().mockResolvedValue(true);

    await acknowledgeAndForwardToHub({
      event: event("帮我看看foundation项目模块设计的完整性"),
      ackEnabled: false,
      ackEmoji: "👀",
      reply,
      startHubTask,
      forwardIncoming: vi.fn().mockResolvedValue({
        type: "task",
        title: "已创建任务：检查 foundation 模块设计完整性",
        body: "任务：检查 foundation 模块设计完整性\n状态：running",
        metadata: {
          codexPrompt: "检查 foundation 项目模块设计的完整性",
          cwd: "E:\\Projects\\active\\foundation"
        }
      })
    });

    expect(startHubTask).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalledWith(
      "om",
      "已创建任务：检查 foundation 模块设计完整性\n\n任务：检查 foundation 模块设计完整性\n状态：running"
    );
  });

  it("reports task startup failures without falling back to the Hub envelope", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await acknowledgeAndForwardToHub({
      event: event("用 codex 查项目"),
      ackEnabled: false,
      ackEmoji: "",
      reply,
      startHubTask: vi.fn().mockRejectedValue(new Error("task already running: task_1")),
      forwardIncoming: vi.fn().mockResolvedValue({
        type: "task",
        title: "已创建任务：查项目",
        body: "任务：查项目",
        metadata: {
          codexPrompt: "查项目",
          cwd: "E:\\Projects\\active"
        }
      })
    });

    expect(reply).toHaveBeenCalledWith("om", "Codex 任务启动失败：task already running: task_1");
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
