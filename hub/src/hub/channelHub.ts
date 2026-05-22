import { nanoid } from "nanoid";
import type { ChannelRegistry } from "../adapters/registry.js";
import { formatChannelDoctor } from "../adapters/capabilities.js";
import type {
  ChannelEnvelope,
  ChannelName,
  Confirmation,
  ConversationSummary,
  DeliveryAttempt,
  HubState,
  HubTask,
  IncomingChannelMessage,
  OutgoingChannelMessage,
  ProjectContext,
  Priority
} from "../domain.js";
import type { IntentInterpreter } from "../intelligence/intent.js";
import type { InterpretedIntent } from "../intelligence/intent.js";
import type { ChatResponder } from "../intelligence/chatResponder.js";
import type { MemoryRecorder } from "../memory/channelMemory.js";
import { RuleBasedIntentInterpreter } from "../intelligence/codexIntentInterpreter.js";
import { fallbackChannels, routeEnvelope, shouldDedupe } from "../routing/policy.js";
import { executeSmartBiReportLookup } from "../tools/smartBiTool.js";
import { executeFeishuDocumentAnalysis, type FeishuDocumentAnalysisOptions } from "../tools/feishuDocumentTool.js";
import { executeFeishuSheetRead } from "../tools/feishuSheetTool.js";
import { formatNativeToolReply, formatTaskCreatedReply } from "./responseFormatter.js";

const activeTaskStatuses = new Set(["queued", "running", "blocked", "waiting_confirmation"]);

export type ChannelHubOptions = {
  state: HubState;
  registry: ChannelRegistry;
  interpreter?: IntentInterpreter;
  chatResponder?: ChatResponder;
  memoryRecorder?: MemoryRecorder;
  privilegedSenderId?: string;
  codexConfigured?: boolean;
  incomingDebounceMs?: number;
  projectContext?: ProjectContext;
  feishuDocumentAnalysis?: FeishuDocumentAnalysisOptions;
  feishuSheetReadCommand?: string[];
  now?: () => Date;
};

export class ChannelHub {
  constructor(private readonly options: ChannelHubOptions) {}

  getState(): HubState {
    return this.options.state;
  }

  async handleIncoming(message: IncomingChannelMessage): Promise<ChannelEnvelope | undefined> {
    this.options.state.incomingMessages.push(message);
    await this.options.memoryRecorder?.recordIncoming({ message, state: this.options.state });
    if (isMemoryCommand(message.text)) {
      if (this.options.privilegedSenderId && message.senderId !== this.options.privilegedSenderId) {
        return this.emitReply(message.channel, "memory 需要确认", "这类长期记忆动作需要 owner 确认。我先把候选记下来了 🙂", "P2", message.id);
      }
      const memoryReply = await this.options.memoryRecorder?.handleMemoryCommand?.(message);
      if (memoryReply) return this.emitReply(message.channel, "memory 已处理", memoryReply, "P2", message.id);
    }
    if (hasTemporaryMediaForChat(message) && !message.text.trim().startsWith("/")) {
      const chatResponse = await this.options.chatResponder?.respond({ message, state: this.options.state });
      if (chatResponse) return this.emitReply(message.channel, chatResponse.title, chatResponse.text, "P2", message.id);
    }
    const command = await (this.options.interpreter ?? new RuleBasedIntentInterpreter()).interpret({
      message,
      state: this.options.state
    });

    const privilegeReply = this.rejectUnprivilegedCommand(message, command);
    if (privilegeReply) return privilegeReply;

    if (command.kind === "ping") {
      return this.emitReply(message.channel, "pong", "pong", "P1", message.id);
    }

    if (command.kind === "channels_status") {
      const pendingMemoryCandidates = await this.options.memoryRecorder?.pendingMemoryCount?.();
      return this.emitReply(
        message.channel,
        "Doctor 诊断",
        formatChannelDoctor({
          hubOnline: true,
          codexConfigured: this.options.codexConfigured ?? true,
          pendingConfirmations: this.pendingConfirmations().length,
          incomingDebounceMs: this.options.incomingDebounceMs ?? 0,
          activeTasks: this.options.state.tasks.filter((task) => activeTaskStatuses.has(task.status)).length,
          failedTasks: this.options.state.tasks.filter((task) => task.status === "failed" || task.status === "blocked").length,
          pendingMemoryCandidates: pendingMemoryCandidates ?? 0,
          recentIncomingMessages: this.options.state.incomingMessages.length,
          chatConfigured: Boolean(this.options.chatResponder)
        }),
        "P1",
        message.id
      );
    }

    if (command.kind === "help") {
      return this.emitReply(message.channel, "可用说法", this.formatHelp(), "P2", message.id);
    }

    if (command.kind === "assistant_reply") {
      if (await this.options.memoryRecorder?.hasCurrentSenderMemory?.(message)) {
        const chatResponse = await this.options.chatResponder?.respond({ message, state: this.options.state });
        if (chatResponse) return this.emitReply(message.channel, chatResponse.title, chatResponse.text, "P2", message.id);
      }
      return this.emitReply(message.channel, command.title, command.text, "P2", message.id);
    }

    if (command.kind === "status") {
      const body = command.abnormalOnly
        ? this.formatAbnormalStatus()
        : command.target
          ? this.formatTargetStatus(command.target)
          : this.formatStatus();
      return this.emitReply(message.channel, "当前状态", body, "P2", message.id);
    }

    if (command.kind === "codex") {
      if (command.routeMode === "fast_lookup" && command.toolId === "feishu_document_read_analyze") {
        const result = await executeFeishuDocumentAnalysis({ query: message.text }, this.options.feishuDocumentAnalysis ?? {});
        const reply = formatNativeToolReply({ toolId: "feishu_document_read_analyze", title: result.title, text: result.text });
        return this.emitReply(message.channel, reply.title, reply.text, "P1", message.id, reply.actions);
      }
      if (command.routeMode === "fast_lookup" && command.toolId === "feishu_sheet_read") {
        const result = await executeFeishuSheetRead(
          { query: message.text },
          { readCommand: this.options.feishuSheetReadCommand, timeoutMs: this.options.feishuDocumentAnalysis?.openAiTimeoutMs }
        );
        const reply = formatNativeToolReply({ toolId: "feishu_sheet_read", title: result.title, text: result.text });
        return this.emitReply(message.channel, reply.title, reply.text, "P1", message.id, reply.actions);
      }
      if (command.routeMode === "fast_lookup" && command.toolId === "smartbi_report_lookup") {
        const result = await executeSmartBiReportLookup({ query: message.text });
        const reply = formatNativeToolReply({ toolId: "smartbi_report_lookup", title: result.title, text: result.text });
        return this.emitReply(message.channel, reply.title, reply.text, "P1", message.id, reply.actions);
      }
      const prompt = appendDingTalkExecutionContract(command.prompt, message.channel);
      const project = this.findProjectForPrompt(prompt);
      const reasoningEffort = command.reasoningEffort ?? inferReasoningEffort(command.prompt, command.name);
      const task = this.createTask({
        name: command.name ?? inferTaskName(command.prompt),
        prompt,
        project: project?.name,
        sourceChannel: message.channel,
        sessionKey: message.sessionKey,
        cwd: project?.path
      });
      return this.emitEnvelope({
        type: "task",
        priority: "P1",
        source: "channel",
        requiresReply: false,
        preferredChannel: message.channel,
        title: `已创建任务：${task.name}`,
        body: formatTaskCreatedReply({ taskName: task.name, status: task.status }),
        taskId: task.id,
        project: task.project,
        context: message.id ? { replyToMessageId: message.id } : undefined,
        metadata: {
          bridgeManaged: true,
          codexPrompt: prompt,
          cwd: project?.path,
          reasoningEffort
        }
      });
    }

    if (command.kind === "cancel") {
      const task = this.findTaskByTarget(command.target);
      if (!task) return this.emitReply(message.channel, "当前没有可取消的任务。", "当前没有可取消的任务。", "P1", message.id);
      task.status = "cancelled";
      task.current = false;
      task.updatedAt = this.nowIso();
      return this.emitReply(message.channel, `已取消任务：${task.name}`, `已取消任务：${task.name}`, "P1", message.id);
    }

    if (command.kind === "confirm") {
      const resolution = this.resolveConfirmationTarget(command.target);
      if (resolution.kind === "missing") {
        return this.emitReply(message.channel, "当前没有待确认事项。", "当前没有待确认事项。", "P1", message.id);
      }
      if (resolution.kind === "ambiguous") {
        return this.emitReply(message.channel, "需要指定确认项", resolution.message, "P1", message.id);
      }

      const confirmation = resolution.confirmation;
      const approved = command.answer === "yes";
      confirmation.status = approved ? "approved" : "rejected";
      confirmation.response = command.answer;
      confirmation.resolvedByChannel = message.channel;
      confirmation.resolvedAt = this.nowIso();
      return this.emitReply(
        message.channel,
        `确认项已${approved ? "同意" : "拒绝"}：${confirmation.title}`,
        `确认项已${approved ? "同意" : "拒绝"}：${confirmation.title}`,
        "P1",
        message.id
      );
    }

    if (command.kind === "reply") {
      const resolution = this.resolveConfirmationTarget(command.target);
      if (resolution.kind === "missing") {
        return this.emitReply(message.channel, "当前没有可补充说明的待确认事项。", "当前没有可补充说明的待确认事项。", "P1", message.id);
      }
      if (resolution.kind === "ambiguous") {
        return this.emitReply(message.channel, "需要指定确认项", resolution.message, "P1", message.id);
      }
      resolution.confirmation.response = command.text;
      resolution.confirmation.resolvedByChannel = message.channel;
      return this.emitReply(message.channel, `已记录补充：${resolution.confirmation.title}`, command.text, "P1", message.id);
    }

    if (command.kind === "route") {
      if (command.persistent) {
        return this.createConfirmation({
          title: "是否保存长期路由规则",
          body: `请求：${message.text}\n影响：会改变后续输出渠道策略。`,
          taskId: undefined,
          requestedBy: "user",
          priority: "P0"
        });
      }
      const preferredChannel = command.channel === "both" ? "both" : command.channel;
      return this.emitEnvelope({
        type: "chat",
        priority: command.channel === "both" ? "P0" : "P1",
        source: "user",
        requiresReply: false,
        preferredChannel,
        title: "路由调整",
        body: `已按你的要求路由：${message.text}`
      });
    }

    if (command.kind === "quiet") {
      return this.emitReply(message.channel, "已记录免打扰偏好", "今天会抑制低优先级即时推送，P0/P1 仍会提醒。", "P1", message.id);
    }

    const chatResponse = await this.options.chatResponder?.respond({ message, state: this.options.state });
    if (chatResponse) return this.emitReply(message.channel, chatResponse.title, chatResponse.text, "P2", message.id);

    return this.emitReply(
      message.channel,
      "我没理解这条消息",
      this.formatUnknownHelp(message.text),
      "P2",
      message.id
    );
  }

  createTask(input: { name: string; prompt?: string; project?: string; sourceChannel?: ChannelName; sessionKey?: string; cwd?: string }): HubTask {
    const now = this.nowIso();
    for (const task of this.options.state.tasks) task.current = false;
    const task: HubTask = {
      id: `task_${nanoid(8)}`,
      visibleNo: this.nextTaskNo(),
      name: input.name,
      prompt: input.prompt,
      project: input.project,
      status: "running",
      sourceChannel: input.sourceChannel,
      current: true,
      createdAt: now,
      updatedAt: now,
      metadata: {
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {})
      }
    };
    this.options.state.tasks.push(task);
    return task;
  }

  async syncConversationSummary(input: {
    title: string;
    project?: string;
    status: ConversationSummary["status"];
    summary: string;
    decisions?: string[];
    nextActions?: string[];
    needsDecision?: boolean;
    highRisk?: boolean;
    source?: ConversationSummary["source"];
    context?: Record<string, unknown>;
  }): Promise<ChannelEnvelope> {
    const needsDecision = input.needsDecision ?? false;
    const highRisk = input.highRisk ?? false;
    const decisions = input.decisions ?? [];
    const nextActions = input.nextActions ?? [];
    const priority: Priority = highRisk ? "P0" : needsDecision || input.status === "failed" || input.status === "blocked" ? "P1" : "P2";
    const summary: ConversationSummary = {
      id: `sum_${nanoid(8)}`,
      title: input.title,
      project: input.project,
      status: input.status,
      summary: input.summary,
      decisions,
      nextActions,
      needsDecision,
      highRisk,
      source: input.source ?? "codex",
      createdAt: this.nowIso(),
      context: input.context
    };
    this.options.state.conversationSummaries.push(summary);

    const envelope = await this.emitEnvelope({
      type: input.status === "failed" || input.status === "blocked" ? "error" : "report",
      priority,
      project: input.project,
      source: summary.source,
      requiresReply: needsDecision || highRisk,
      preferredChannel: "auto",
      title: input.title,
      body: this.formatConversationSummary(summary),
      context: {
        summaryId: summary.id,
        ...input.context
      }
    });
    summary.envelopeId = envelope.id;
    return envelope;
  }

  async createConfirmation(input: {
    title: string;
    body: string;
    taskId?: string;
    requestedBy: Confirmation["requestedBy"];
    priority?: Priority;
  }): Promise<ChannelEnvelope> {
    const now = this.nowIso();
    const confirmation: Confirmation = {
      id: `c_${nanoid(8)}`,
      taskId: input.taskId,
      visibleNo: this.nextConfirmationNo(),
      title: input.title,
      body: input.body,
      status: "pending",
      allowedActions: ["approve", "reject", "modify", "cancel"],
      requestedBy: input.requestedBy,
      createdAt: now
    };
    this.options.state.confirmations.push(confirmation);
    return this.emitEnvelope({
      type: "confirmation",
      priority: input.priority ?? "P1",
      source: input.requestedBy,
      requiresReply: true,
      preferredChannel: "auto",
      title: input.title,
      body: `${input.body}\n\n回复：同意 ${confirmation.visibleNo} / 不同意 ${confirmation.visibleNo} / 补充 ${confirmation.visibleNo} ...`,
      actions: [
        { label: `同意 ${confirmation.visibleNo}`, value: `同意 ${confirmation.visibleNo}`, style: "primary" },
        { label: `不同意 ${confirmation.visibleNo}`, value: `不同意 ${confirmation.visibleNo}`, style: "danger" },
        { label: `补充 ${confirmation.visibleNo}`, value: `补充 ${confirmation.visibleNo} `, style: "default" },
        { label: `取消 ${confirmation.visibleNo}`, value: `取消 ${confirmation.visibleNo}`, style: "default" }
      ],
      taskId: input.taskId,
      confirmationId: confirmation.id
    });
  }

  async emitEnvelope(input: Omit<ChannelEnvelope, "id" | "createdAt"> & { id?: string }): Promise<ChannelEnvelope> {
    const envelope: ChannelEnvelope = {
      ...input,
      id: input.id ?? `env_${nanoid(10)}`,
      createdAt: this.nowIso()
    };

    if (shouldDedupe({ envelope, existing: this.options.state.envelopes })) {
      this.recordSkipped(envelope, "dingtalk", "deduped");
      return envelope;
    }

    this.options.state.envelopes.push(envelope);
    const sourceChannel = envelope.taskId ? this.options.state.tasks.find((task) => task.id === envelope.taskId)?.sourceChannel : undefined;
    const channels = routeEnvelope(envelope, sourceChannel);

    for (const channel of channels) {
      await this.deliver(envelope, channel, new Set());
    }
    return envelope;
  }

  formatStatus(): string {
    const activeTasks = this.options.state.tasks.filter((task) => activeTaskStatuses.has(task.status));
    const pendingConfirmations = this.pendingConfirmations();
    const lines = ["当前状态", "", "运行中任务："];

    if (activeTasks.length === 0) lines.push("- 无");
    for (const task of activeTasks) {
      lines.push(`${task.visibleNo}. ${task.name}`);
      lines.push(`   状态：${task.status}`);
      lines.push(`   最近：${task.lastProgress ?? task.prompt ?? "-"}`);
    }

    lines.push("", "待确认：");
    if (pendingConfirmations.length === 0) lines.push("- 无");
    for (const item of pendingConfirmations) {
      lines.push(`${item.visibleNo}. ${item.title}`);
      lines.push(`   内容：${item.body}`);
    }

    lines.push("", "可直接回复：取消 1 / 同意 1 / 不同意 1 / 补充 1 你的说明");
    return lines.join("\n");
  }

  formatAbnormalStatus(): string {
    const failedTasks = this.options.state.tasks.filter((task) => task.status === "failed" || task.status === "blocked");
    const pendingConfirmations = this.pendingConfirmations();
    const lines = ["今日异常/待处理", ""];

    lines.push("异常任务：");
    if (failedTasks.length === 0) lines.push("- 无");
    for (const task of failedTasks) lines.push(`${task.visibleNo}. ${task.name} - ${task.status}`);

    lines.push("", "待确认：");
    if (pendingConfirmations.length === 0) lines.push("- 无");
    for (const item of pendingConfirmations) lines.push(`${item.visibleNo}. ${item.title}`);

    return lines.join("\n");
  }

  formatTargetStatus(target: string): string {
    const task = this.findTaskByTarget(target);
    if (task) {
      return [
        `任务：${task.name}`,
        `编号：${task.visibleNo}`,
        `状态：${task.status}`,
        `最近：${task.lastProgress ?? task.finalMessage ?? task.error ?? task.prompt ?? "-"}`
      ].join("\n");
    }

    const project = this.options.projectContext?.findProject(target);
    if (project) {
      const lines = [
        `项目：${project.name}`,
        `状态：${project.runningProcesses.length > 0 ? "running" : "idle"}`,
        `工作目录：${project.path}`
      ];
      if (project.runningProcesses.length > 0) {
        lines.push("", "本机相关进程：");
        for (const process of project.runningProcesses.slice(0, 5)) {
          lines.push(`- ${process.name} ${process.pid}`);
          if (process.commandLine) lines.push(`  ${process.commandLine}`);
        }
      }
      return lines.join("\n");
    }

    const summary = this.findConversationSummaryByTarget(target);
    if (summary) {
      const lines = [
        `项目：${summary.project ?? summary.title}`,
        `状态：${summary.status}`,
        "",
        summary.summary
      ];
      if (summary.decisions.length > 0) {
        lines.push("", "决策：");
        for (const item of summary.decisions) lines.push(`- ${item}`);
      }
      if (summary.nextActions.length > 0) {
        lines.push("", "后续：");
        for (const item of summary.nextActions) lines.push(`- ${item}`);
      }
      return lines.join("\n");
    }

    const confirmation = this.findConfirmationByTarget(target);
    if (confirmation) {
      return [
        `待确认：${confirmation.title}`,
        `编号：${confirmation.visibleNo}`,
        `状态：${confirmation.status}`,
        `内容：${confirmation.body}`
      ].join("\n");
    }

    return `没找到：${target}\n\n可发送 /status 查看当前任务和待确认项。`;
  }

  private async emitReply(
    channel: ChannelName,
    title: string,
    body: string,
    priority: Priority,
    replyToMessageId?: string,
    actions?: ChannelEnvelope["actions"]
  ): Promise<ChannelEnvelope> {
    return this.emitEnvelope({
      type: "chat",
      priority,
      source: "channel",
      requiresReply: false,
      preferredChannel: channel,
      title,
      body,
      actions,
      context: replyToMessageId ? { replyToMessageId } : undefined,
      metadata: replyToMessageId ? { directReplyOnly: true, replyToMessageId } : undefined
    });
  }

  private async deliver(envelope: ChannelEnvelope, channel: ChannelName, visited: Set<ChannelName>): Promise<void> {
    if (visited.has(channel)) return;
    visited.add(channel);
    const attempt = this.createAttempt(envelope.id, channel);
    const adapter = this.options.registry.get(channel);
    if (!adapter) {
      attempt.status = "failed";
      attempt.error = "adapter not registered";
      attempt.completedAt = this.nowIso();
      return;
    }

    const outgoing: OutgoingChannelMessage = {
      envelopeId: envelope.id,
      channel,
      title: envelope.title,
      body: envelope.body,
      priority: envelope.priority,
      taskId: envelope.taskId,
      confirmationId: envelope.confirmationId,
      actions: envelope.actions,
      metadata: envelope.metadata
    };
    const result = await adapter.send(outgoing);
    attempt.status = result.ok ? "sent" : "failed";
    attempt.platformMessageId = result.platformMessageId;
    attempt.error = result.error;
    attempt.completedAt = this.nowIso();

    if (!result.ok && envelope.priority !== "P3") {
      for (const fallback of fallbackChannels(channel)) {
        if (fallback !== channel) await this.deliver(envelope, fallback, visited);
      }
    }
  }

  private createAttempt(envelopeId: string, channel: ChannelName): DeliveryAttempt {
    const attempt: DeliveryAttempt = {
      id: `del_${nanoid(8)}`,
      envelopeId,
      channel,
      status: "pending",
      createdAt: this.nowIso()
    };
    this.options.state.deliveryAttempts.push(attempt);
    return attempt;
  }

  private recordSkipped(envelope: ChannelEnvelope, channel: ChannelName, status: "deduped" | "skipped"): void {
    this.options.state.deliveryAttempts.push({
      id: `del_${nanoid(8)}`,
      envelopeId: envelope.id,
      channel,
      status,
      createdAt: this.nowIso(),
      completedAt: this.nowIso()
    });
  }

  private resolveConfirmationTarget(target?: string):
    | { kind: "found"; confirmation: Confirmation }
    | { kind: "missing" }
    | { kind: "ambiguous"; message: string } {
    const pending = this.pendingConfirmations();
    if (!target) {
      if (pending.length === 0) return { kind: "missing" };
      if (pending.length > 1) {
        const choices = pending.map((item) => `${item.visibleNo}. ${item.title}`).join("\n");
        return { kind: "ambiguous", message: `有 ${pending.length} 个待确认。请回复：同意 1 / 同意 2\n\n${choices}` };
      }
      return { kind: "found", confirmation: pending[0] };
    }

    const item = this.findConfirmationByTarget(target);
    return item && item.status === "pending" ? { kind: "found", confirmation: item } : { kind: "missing" };
  }

  private findCurrentTask(): HubTask | undefined {
    return this.options.state.tasks.find((task) => task.current && activeTaskStatuses.has(task.status));
  }

  private findTaskByTarget(target?: string): HubTask | undefined {
    if (!target) return this.findCurrentTask();
    const index = Number.parseInt(target, 10);
    if (Number.isInteger(index) && String(index) === target && index > 0) {
      return this.options.state.tasks.find((task) => task.visibleNo === index);
    }
    return (
      this.options.state.tasks.find((task) => task.id === target) ??
      this.options.state.tasks.find((task) => task.name === target) ??
      this.options.state.tasks.find((task) => activeTaskStatuses.has(task.status) && task.name.includes(target))
    );
  }

  private findConfirmationByTarget(target?: string): Confirmation | undefined {
    if (!target) return this.pendingConfirmations().at(-1);
    const index = Number.parseInt(target, 10);
    if (Number.isInteger(index) && String(index) === target && index > 0) {
      return this.options.state.confirmations.find((confirmation) => confirmation.visibleNo === index);
    }
    return (
      this.options.state.confirmations.find((confirmation) => confirmation.id === target) ??
      this.options.state.confirmations.find((confirmation) => confirmation.title === target) ??
      this.options.state.confirmations.find((confirmation) => confirmation.status === "pending" && confirmation.title.includes(target))
    );
  }

  private findConversationSummaryByTarget(target: string): ConversationSummary | undefined {
    const normalized = target.toLowerCase();
    const aliases = new Set([normalized]);
    if (normalized.includes("knowledge-base") || normalized.includes("knowledgebase")) {
      aliases.add("知识库");
      aliases.add("业务知识库");
    }
    return this.options.state.conversationSummaries
      .slice()
      .reverse()
      .find((summary) => {
        const project = summary.project?.toLowerCase() ?? "";
        const title = summary.title.toLowerCase();
        return [...aliases].some((alias) => project === alias || title === alias || project.includes(alias) || title.includes(alias));
      });
  }

  private findProjectForPrompt(prompt?: string): { name: string; path: string } | undefined {
    if (!prompt || !this.options.projectContext) return undefined;
    const candidates = [
      ...prompt.matchAll(/([A-Za-z0-9][A-Za-z0-9_-]*)\s*(?:项目|工程|仓库|repo|repository)/gi),
      ...prompt.matchAll(/(?:项目|工程|仓库|repo|repository)\s*([A-Za-z0-9][A-Za-z0-9_-]*)/gi)
    ];
    for (const match of candidates) {
      const project = this.options.projectContext.findProject(match[1]);
      if (project) return { name: project.name, path: project.path };
    }
    return undefined;
  }

  private pendingConfirmations(): Confirmation[] {
    return this.options.state.confirmations.filter((item) => item.status === "pending");
  }

  private formatHelp(): string {
    return [
      "你可以这样说：",
      "/status",
      "查看 任务名称",
      "今天有什么异常",
      "同意 1",
      "不同意 1",
      "补充 1 你的说明",
      "取消 1",
      "这条发飞书归档"
    ].join("\n");
  }

  private formatConversationSummary(summary: ConversationSummary): string {
    const lines = [
      `状态：${summary.status}`,
      summary.project ? `项目：${summary.project}` : undefined,
      "",
      summary.summary
    ].filter((line): line is string => line !== undefined);

    if (summary.decisions.length > 0) {
      lines.push("", "决策：");
      for (const item of summary.decisions) lines.push(`- ${item}`);
    }

    if (summary.nextActions.length > 0) {
      lines.push("", "后续：");
      for (const item of summary.nextActions) lines.push(`- ${item}`);
    }

    if (summary.needsDecision) {
      lines.push("", "需要你处理：是");
    }
    if (summary.highRisk) {
      lines.push("风险：高风险，已双发");
    }

    return lines.join("\n");
  }

  private formatUnknownHelp(text: string): string {
    return [
      `我没理解：${text}`,
      "",
      "可以这样表达：",
      "- 查状态：查看 / 今天有什么异常",
      "- 做决定：同意 1 / 不同意 1",
      "- 加限制：补充 1 只允许改文档",
      "- 取消任务：取消 1",
      "- 改路由：这条发飞书归档 / 这个双发"
    ].join("\n");
  }

  private nextTaskNo(): number {
    return Math.max(0, ...this.options.state.tasks.map((task) => task.visibleNo)) + 1;
  }

  private nextConfirmationNo(): number {
    return Math.max(0, ...this.options.state.confirmations.map((item) => item.visibleNo)) + 1;
  }

  private nowIso(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private rejectUnprivilegedCommand(message: IncomingChannelMessage, command: InterpretedIntent): Promise<ChannelEnvelope> | undefined {
    if (!this.options.privilegedSenderId) return undefined;
    if (this.isPrivilegedSender(message.senderId)) return undefined;
    if (!isPrivilegedIntent(command)) return undefined;
    return this.emitReply(
      message.channel,
      "需要本人确认",
      "这个动作涉及本机执行、任务控制或长期记忆，需要 owner 本人确认。我可以先帮你把想法整理一下 🙂",
      "P1",
      message.id
    );
  }

  private isPrivilegedSender(senderId: string): boolean {
    return Boolean(this.options.privilegedSenderId) && senderId === this.options.privilegedSenderId;
  }
}

function isMemoryCommand(text: string): boolean {
  return /^(?:(?:\/?memory|记忆|记住)\s*(?:写入|保存|确认|忽略|跳过|删除|剔除|列表|list|全部写入|全部忽略|全部剔除)\b|(?:请你)?记住\s*[:：]?.+|(?:剔除|删除|忽略|跳过)\s*[\d\s,，、]+$|(?:保留|都保留)$)/i.test(text.trim());
}

function hasTemporaryMediaForChat(message: IncomingChannelMessage): boolean {
  return (message.attachments ?? []).some((attachment) => attachment.type === "image" || attachment.type === "audio");
}

function isPrivilegedIntent(command: InterpretedIntent): boolean {
  if (command.kind === "codex" && isReadOnlyNativeTool(command)) return false;
  if (command.kind === "codex" && isReadOnlyExternalLinkReview(command)) return false;
  return ["codex", "cancel", "confirm", "reply", "route", "quiet"].includes(command.kind);
}

function isReadOnlyNativeTool(command: InterpretedIntent): boolean {
  if (command.kind !== "codex") return false;
  return command.routeMode === "fast_lookup" && Boolean(command.toolId);
}

function isReadOnlyExternalLinkReview(command: InterpretedIntent): boolean {
  if (command.kind !== "codex") return false;
  if (command.routeMode !== "fast_lookup") return false;
  const prompt = command.prompt ?? "";
  return (
    /https?:\/\//i.test(prompt) &&
    /请检查用户发来的(?:飞书文档\/知识库链接|外部链接)/.test(prompt) &&
    /不要修改任何文件/.test(prompt) &&
    /只做临时读取和分析/.test(prompt)
  );
}

function inferReasoningEffort(prompt: string, name?: string): "medium" | "high" | "xhigh" {
  const text = `${name ?? ""}\n${prompt}`.toLowerCase();
  if (/(xhigh|最高推理|最强推理|深度推理|彻底|完整重构|大型重构|复杂架构|疑难|hard bug|race condition)/i.test(text)) return "xhigh";
  if (/(深入|深度|完整检查|系统分析|架构|重构|修复|跑测试|直到通过|风险|eta|预估|预计|完成度|进度评估|质量|阻塞|debug|diagnose|refactor|architecture|test)/i.test(text)) return "high";
  return "medium";
}

function inferTaskName(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const withoutPrefix = normalized.replace(/^(帮我|请|麻烦你|你来|给我)/, "");
  return withoutPrefix.slice(0, 24) || "未命名任务";
}

function appendDingTalkExecutionContract(prompt: string, channel: ChannelName): string {
  if (channel !== "dingtalk") return prompt;
  return [
    prompt.trim(),
    "",
    "钉钉结果回复要求：",
    "1. 直接给用户可读结论，不要输出工程化检查流水账。",
    "2. 最多 600 个中文字符；除非用户明确要明细表，否则不要使用 Markdown 表格。",
    "3. 第一行必须是重点结论；随后只列 2-5 条最有用的信息。",
    "4. 如果没有完成任务，不要写“任务完成”；请写“没查全/卡住了”的原因，以及下一步只缺什么。",
    "5. 不要暴露无关实现细节、完整路径、脚本名、日志位置；只有在它们能帮助用户下一步操作时才保留。"
  ].join("\n");
}
