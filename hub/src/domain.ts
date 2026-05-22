export type ChannelName = "dingtalk" | "lark";
export type Priority = "P0" | "P1" | "P2" | "P3";

export type EnvelopeType =
  | "task"
  | "confirmation"
  | "automation_result"
  | "report"
  | "error"
  | "chat";

export type PreferredChannel = "auto" | ChannelName | "both";

export type ChannelEnvelope = {
  id: string;
  type: EnvelopeType;
  priority: Priority;
  project?: string;
  source: "codex" | "script" | "automation" | "user" | "channel";
  requiresReply: boolean;
  preferredChannel: PreferredChannel;
  title: string;
  body: string;
  actions?: ChannelAction[];
  taskId?: string;
  confirmationId?: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ChannelAction = {
  label: string;
  value: string;
  style?: "primary" | "danger" | "default";
};

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type HubTask = {
  id: string;
  visibleNo: number;
  name: string;
  prompt?: string;
  project?: string;
  status: TaskStatus;
  sourceChannel?: ChannelName;
  current: boolean;
  createdAt: string;
  updatedAt: string;
  lastProgress?: string;
  finalMessage?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type ConfirmationStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type Confirmation = {
  id: string;
  taskId?: string;
  visibleNo: number;
  title: string;
  body: string;
  status: ConfirmationStatus;
  allowedActions: Array<"approve" | "reject" | "modify" | "cancel">;
  requestedBy: "codex" | "script" | "automation" | "user";
  resolvedByChannel?: ChannelName;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  response?: string;
  context?: Record<string, unknown>;
};

export type DeliveryStatus = "pending" | "sent" | "failed" | "deduped" | "skipped";

export type DeliveryAttempt = {
  id: string;
  envelopeId: string;
  channel: ChannelName;
  status: DeliveryStatus;
  platformMessageId?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
};

export type IncomingChannelMessage = {
  id: string;
  channel: ChannelName;
  senderId: string;
  senderNick?: string;
  text: string;
  attachments?: Array<{
    type: "image" | "audio" | "file";
    url?: string;
    downloadCode?: string;
    mediaId?: string;
    name?: string;
  }>;
  sessionKey?: string;
  conversationType?: "direct" | "group" | "thread";
  threadId?: string;
  replyToMessageId?: string;
  receivedAt: string;
  raw?: unknown;
};

export type ConversationSummaryStatus = "completed" | "failed" | "blocked";

export type ConversationSummary = {
  id: string;
  title: string;
  project?: string;
  status: ConversationSummaryStatus;
  summary: string;
  decisions: string[];
  nextActions: string[];
  needsDecision: boolean;
  highRisk: boolean;
  source: "codex" | "automation" | "user";
  createdAt: string;
  envelopeId?: string;
  context?: Record<string, unknown>;
};

export type OutgoingChannelMessage = {
  envelopeId: string;
  channel: ChannelName;
  title: string;
  body: string;
  priority: Priority;
  taskId?: string;
  confirmationId?: string;
  actions?: Array<{
    label: string;
    value: string;
    style?: "primary" | "danger" | "default";
  }>;
  metadata?: Record<string, unknown>;
};

export type DeliveryResult = {
  ok: boolean;
  platformMessageId?: string;
  error?: string;
};

export type ChannelAdapter = {
  name: ChannelName;
  send(message: OutgoingChannelMessage): Promise<DeliveryResult>;
};

export type ProjectProcess = {
  pid: number;
  name: string;
  commandLine?: string;
};

export type ProjectSnapshot = {
  name: string;
  path: string;
  runningProcesses: ProjectProcess[];
};

export type ProjectContext = {
  findProject(target: string): ProjectSnapshot | undefined;
};

export type HubState = {
  tasks: HubTask[];
  confirmations: Confirmation[];
  envelopes: ChannelEnvelope[];
  deliveryAttempts: DeliveryAttempt[];
  incomingMessages: IncomingChannelMessage[];
  conversationSummaries: ConversationSummary[];
};
