export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type NotificationStatus = "success" | "warning" | "failed" | "info";
export type ConfirmationStatus = "open" | "approved" | "rejected" | "answered" | "expired";

export type ChannelMessageAttachment = {
  type: "image" | "audio" | "file";
  url?: string;
  downloadCode?: string;
  mediaId?: string;
  name?: string;
};

export type ChannelMessageEvent = {
  eventId: string;
  messageId: string;
  conversationId: string;
  conversationType: "1" | "2";
  senderId: string;
  senderStaffId: string;
  senderNick?: string;
  content: string;
  messageType: string;
  createTime: string;
  sessionWebhook?: string;
  robotCode?: string;
  attachments?: ChannelMessageAttachment[];
  raw?: unknown;
};

export type BridgeTask = {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  lastProgress?: string;
  finalMessage?: string;
  error?: string;
  reasoningEffort?: string;
  channelMessageId?: string;
  channelConversationId?: string;
};

export type ConfirmationItem = {
  id: string;
  taskId?: string;
  title: string;
  reason: string;
  suggestedAction: string;
  status: ConfirmationStatus;
  createdAt: string;
  updatedAt: string;
  response?: string;
};

export type BridgeNotification = {
  id: string;
  title: string;
  status: NotificationStatus;
  body: string;
  createdAt: string;
  source?: string;
  actions?: Array<{
    label: string;
    value: string;
    style?: "primary" | "danger" | "default";
  }>;
  metadata?: Record<string, unknown>;
};

export type BridgeState = {
  tasks: BridgeTask[];
  confirmations: ConfirmationItem[];
  notifications: BridgeNotification[];
};
