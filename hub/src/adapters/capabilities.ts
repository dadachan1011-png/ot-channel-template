import type { ChannelName } from "../domain.js";

export type ChannelCapability = {
  channel: ChannelName;
  canReceive: boolean;
  canReply: boolean;
  canNotify: boolean;
  canConfirm: boolean;
  supportsActions: boolean;
  supportsReactions: boolean;
  supportsTyping: boolean;
  supportsEdit: boolean;
  supportsThreads: boolean;
  maxTextLength: number;
  role: string;
};

export const defaultChannelCapabilities: Record<ChannelName, ChannelCapability> = {
  dingtalk: {
    channel: "dingtalk",
    canReceive: true,
    canReply: true,
    canNotify: true,
    canConfirm: true,
    supportsActions: false,
    supportsReactions: false,
    supportsTyping: true,
    supportsEdit: false,
    supportsThreads: false,
    maxTextLength: 3500,
    role: "高频行动、确认和失败提醒"
  },
  lark: {
    channel: "lark",
    canReceive: true,
    canReply: true,
    canNotify: true,
    canConfirm: true,
    supportsActions: false,
    supportsReactions: false,
    supportsTyping: true,
    supportsEdit: false,
    supportsThreads: true,
    maxTextLength: 3500,
    role: "项目上下文、摘要和可检索归档"
  }
};

export function formatChannelDoctor(input: {
  hubOnline: boolean;
  codexConfigured: boolean;
  pendingConfirmations: number;
  incomingDebounceMs: number;
  activeTasks?: number;
  failedTasks?: number;
  pendingMemoryCandidates?: number;
  recentIncomingMessages?: number;
  chatConfigured?: boolean;
}): string {
  const lines = [
    "Doctor 诊断",
    "",
    `Hub：${input.hubOnline ? "在线" : "异常"}`,
    `LLM 问答：${input.chatConfigured === false ? "未配置" : "已配置"}`,
    `Codex 执行：${input.codexConfigured ? "已配置" : "未配置"}`,
    `输入防抖：${input.incomingDebounceMs}ms`,
    `活跃任务：${input.activeTasks ?? 0}`,
    `失败/阻塞任务：${input.failedTasks ?? 0}`,
    `待确认：${input.pendingConfirmations}`,
    `待确认 memory：${input.pendingMemoryCandidates ?? 0}`,
    `最近消息缓存：${input.recentIncomingMessages ?? 0}`,
    "",
    "通道能力："
  ];

  for (const capability of Object.values(defaultChannelCapabilities)) {
    lines.push(
      `${capability.channel}：${capability.canNotify ? "可通知" : "不可通知"}，${capability.canReply ? "可回复" : "不可回复"}，${
        capability.supportsThreads ? "支持线程" : "不支持线程"
      }，${capability.role}`
    );
  }

  return lines.join("\n");
}
