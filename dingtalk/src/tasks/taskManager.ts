import { win32 } from "node:path";
import { nanoid } from "nanoid";
import type { BridgeNotification, BridgeState, BridgeTask, ConfirmationItem } from "../domain.js";

const activeTaskStatuses = new Set(["queued", "running", "waiting_confirmation"]);

export class TaskManager {
  constructor(
    private readonly state: BridgeState,
    private readonly allowedWorkspaceRoot: string
  ) {}

  getState(): BridgeState {
    return this.state;
  }

  createCodexTask(
    prompt: string,
    cwd: string,
    channelContext?: { conversationId: string; messageId: string; name?: string; reasoningEffort?: string }
  ): BridgeTask {
    const running = this.state.tasks.find((task) => activeTaskStatuses.has(task.status));
    if (running) throw new Error(`task already running: ${running.id}`);

    const root = win32.resolve(this.allowedWorkspaceRoot);
    const target = win32.resolve(cwd);
    const rel = win32.relative(root, target);
    if (rel.startsWith("..") || win32.isAbsolute(rel)) {
      throw new Error(`cwd outside allowed root: ${cwd}`);
    }

    const now = new Date().toISOString();
    const task: BridgeTask = {
      id: `task_${nanoid(8)}`,
      name: channelContext?.name || inferTaskName(prompt),
      prompt,
      cwd: target,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      reasoningEffort: channelContext?.reasoningEffort,
      channelConversationId: channelContext?.conversationId,
      channelMessageId: channelContext?.messageId
    };
    this.state.tasks.push(task);
    return task;
  }

  updateTask(id: string, patch: Partial<BridgeTask>): BridgeTask {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task) throw new Error(`task not found: ${id}`);
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    return task;
  }

  cancelTask(id: string): BridgeTask {
    return this.updateTask(id, { status: "cancelled" });
  }

  recoverInterruptedActiveTasks(reason = "Interrupted because the DingTalk bridge restarted."): BridgeTask[] {
    const recovered: BridgeTask[] = [];
    const now = new Date().toISOString();
    for (const task of this.state.tasks) {
      if (!activeTaskStatuses.has(task.status)) continue;
      task.status = "failed";
      task.error = reason;
      task.updatedAt = now;
      recovered.push(task);
    }
    return recovered;
  }

  findCurrentTask(): BridgeTask | undefined {
    return this.state.tasks.find((task) => activeTaskStatuses.has(task.status));
  }

  findTaskByTarget(target?: string): BridgeTask | undefined {
    if (!target) return this.findCurrentTask();
    const activeTasks = this.state.tasks.filter((task) => activeTaskStatuses.has(task.status));
    const index = Number.parseInt(target, 10);
    if (Number.isInteger(index) && String(index) === target && index > 0) return activeTasks[index - 1];
    return (
      this.state.tasks.find((task) => task.id === target) ??
      this.state.tasks.find((task) => task.name === target) ??
      activeTasks.find((task) => task.name.includes(target))
    );
  }

  createConfirmation(input: Omit<ConfirmationItem, "id" | "status" | "createdAt" | "updatedAt">): ConfirmationItem {
    const now = new Date().toISOString();
    const item: ConfirmationItem = {
      ...input,
      id: `c_${nanoid(8)}`,
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.state.confirmations.push(item);
    return item;
  }

  answerConfirmation(id: string, response: string, approved: boolean): ConfirmationItem {
    const item = this.state.confirmations.find((confirmation) => confirmation.id === id);
    if (!item) throw new Error(`confirmation not found: ${id}`);
    item.status = approved ? "approved" : "rejected";
    item.response = response;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  findLatestOpenConfirmation(): ConfirmationItem | undefined {
    return [...this.state.confirmations].reverse().find((confirmation) => confirmation.status === "open");
  }

  findConfirmationByTarget(target?: string): ConfirmationItem | undefined {
    if (!target) return this.findLatestOpenConfirmation();
    const openConfirmations = this.state.confirmations.filter((confirmation) => confirmation.status === "open");
    const index = Number.parseInt(target, 10);
    if (Number.isInteger(index) && String(index) === target && index > 0) return openConfirmations[index - 1];
    return (
      this.state.confirmations.find((confirmation) => confirmation.id === target) ??
      openConfirmations.find((confirmation) => confirmation.title === target) ??
      openConfirmations.find((confirmation) => confirmation.title.includes(target))
    );
  }

  replyConfirmation(id: string, response: string): ConfirmationItem {
    const item = this.state.confirmations.find((confirmation) => confirmation.id === id);
    if (!item) throw new Error(`confirmation not found: ${id}`);
    item.status = "answered";
    item.response = response;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  addNotification(notification: BridgeNotification): void {
    this.state.notifications.push(notification);
  }

  formatStatus(): string {
    const activeTasks = this.state.tasks.filter((task) => activeTaskStatuses.has(task.status));
    const openConfirmations = this.state.confirmations.filter((item) => item.status === "open");

    const lines = ["当前状态", ""];

    lines.push("运行中任务：");
    if (activeTasks.length === 0) {
      lines.push("- 无");
    } else {
      for (const task of activeTasks) {
        const index = activeTasks.indexOf(task) + 1;
        lines.push(`${index}. ${task.name}`);
        lines.push(`   状态：${task.status}`);
        lines.push(`   最近：${task.lastProgress || task.prompt}`);
      }
    }

    lines.push("", "待确认：");
    if (openConfirmations.length === 0) {
      lines.push("- 无");
    } else {
      for (const item of openConfirmations) {
        const index = openConfirmations.indexOf(item) + 1;
        const task = item.taskId ? this.state.tasks.find((candidate) => candidate.id === item.taskId) : undefined;
        lines.push(`${index}. ${item.title}`);
        if (task) lines.push(`   关联任务：${task.name}`);
        lines.push(`   建议：${item.suggestedAction}`);
      }
    }

    lines.push("", "可直接回复：取消 1 / 同意 1 / 不同意 1 / 补充 1 你的说明");
    return lines.join("\n");
  }

  formatTargetStatus(target: string): string {
    const task = this.findTaskByTarget(target);
    if (task) {
      return [
        `任务：${task.name}`,
        `状态：${task.status}`,
        `最近：${task.lastProgress || task.finalMessage || task.error || task.prompt}`,
        `工作目录：${task.cwd}`
      ].join("\n");
    }

    const confirmation = this.findConfirmationByTarget(target);
    if (confirmation) {
      return [
        `待确认：${confirmation.title}`,
        `状态：${confirmation.status}`,
        `原因：${confirmation.reason}`,
        `建议：${confirmation.suggestedAction}`
      ].join("\n");
    }

    return `没找到：${target}\n\n可发送 /status 查看当前任务和待确认项。`;
  }

  formatHelp(raw?: string): string {
    const currentTask = this.findCurrentTask();
    const latestConfirmation = this.findLatestOpenConfirmation();
    const lines = [raw ? `我没理解：${raw}` : "我没理解这条消息。", ""];

    if (currentTask) {
      lines.push("当前任务：");
      lines.push(`- ${currentTask.name}`);
      lines.push("");
      lines.push("你可以直接说：");
      lines.push("查看当前任务");
      lines.push("取消当前任务");
      lines.push(`查看 ${currentTask.name}`);
      lines.push(`取消 ${currentTask.name}`);
      lines.push("");
    }

    if (latestConfirmation) {
      lines.push("当前待确认：");
      lines.push(`- ${latestConfirmation.title}`);
      lines.push("");
      lines.push("你可以直接说：");
      lines.push("同意");
      lines.push("不同意");
      lines.push("补充 只允许改项目配置");
      lines.push("");
    }

    lines.push("通用说法：");
    lines.push("/status");
    lines.push("查看 任务名称");
    lines.push("取消 1");
    lines.push("同意 1");
    lines.push("不同意 1");
    lines.push("补充 1 你的说明");
    lines.push("");
    lines.push("创建任务：");
    lines.push("/codex 名称: 任务名称");
    lines.push("具体要做什么");

    return lines.join("\n");
  }
}

function inferTaskName(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const withoutPrefix = normalized.replace(/^(帮我|请|麻烦你|你来|给我)/, "");
  return withoutPrefix.slice(0, 24) || "未命名任务";
}
