import { describe, expect, it } from "vitest";
import { TaskManager } from "../src/tasks/taskManager.js";

describe("TaskManager", () => {
  it("creates a task when none is running", () => {
    const manager = new TaskManager(
      {
        tasks: [],
        confirmations: [],
        notifications: []
      },
      "E:\\Projects\\active"
    );

    const task = manager.createCodexTask("do work", "E:\\Projects\\active\\channel\\lark");

    expect(task.status).toBe("queued");
    expect(task.prompt).toBe("do work");
    expect(task.name).toBe("do work");
  });

  it("rejects second running task", () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "work",
            prompt: "work",
            cwd: "E:\\Projects\\active\\x",
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

    expect(() => manager.createCodexTask("again", "E:\\Projects\\active\\x")).toThrow(/already running/);
  });

  it("rejects cwd outside allowed root", () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");

    expect(() => manager.createCodexTask("bad", "C:\\Windows")).toThrow(/outside allowed root/);
  });

  it("records confirmation replies", () => {
    const manager = new TaskManager({ tasks: [], confirmations: [], notifications: [] }, "E:\\Projects\\active");
    const item = manager.createConfirmation({
      title: "是否继续",
      reason: "需要确认",
      suggestedAction: "yes"
    });

    const answered = manager.replyConfirmation(item.id, "只允许改项目配置");

    expect(answered.status).toBe("answered");
    expect(answered.response).toBe("只允许改项目配置");
  });

  it("finds task by visible index or name", () => {
    const manager = new TaskManager(
      {
        tasks: [
          {
            id: "task_1",
            name: "lark桥接优化",
            prompt: "work",
            cwd: "E:\\Projects\\active\\x",
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

    expect(manager.findTaskByTarget("1")?.id).toBe("task_1");
    expect(manager.findTaskByTarget("lark桥接优化")?.id).toBe("task_1");
  });
});
