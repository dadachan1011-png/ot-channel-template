export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type NotificationStatus = "success" | "warning" | "failed" | "info";
export type ConfirmationStatus = "open" | "approved" | "rejected" | "answered" | "expired";

export type LarkMessageEvent = {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  content: string;
  messageType: string;
  createTime: string;
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
  larkMessageId?: string;
  larkChatId?: string;
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
