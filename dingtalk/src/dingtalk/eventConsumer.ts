import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream, type RobotMessage } from "dingtalk-stream";
import type { ChannelMessageAttachment, ChannelMessageEvent } from "../domain.js";

type RobotMessageLike = RobotMessage & Record<string, unknown>;

export function mapReceiveEvent(raw: RobotMessage): ChannelMessageEvent {
  const message = raw as RobotMessageLike;
  const attachments = extractAttachments(message);
  const content = extractMessageText(message, attachments);
  return {
    eventId: raw.msgId,
    messageId: raw.msgId,
    conversationId: raw.conversationId,
    conversationType: raw.conversationType as "1" | "2",
    senderId: raw.senderId,
    senderStaffId: raw.senderStaffId,
    senderNick: typeof message.senderNick === "string" ? message.senderNick : undefined,
    content,
    messageType: raw.msgtype,
    createTime: String(raw.createAt),
    sessionWebhook: raw.sessionWebhook,
    robotCode: raw.robotCode,
    ...(attachments.length > 0 ? { attachments } : {}),
    raw: message
  };
}

function extractMessageText(raw: RobotMessageLike, attachments: ChannelMessageAttachment[]): string {
  if (raw.msgtype === "text") {
    const content = (raw as RobotMessage & { text?: { content?: unknown } }).text?.content;
    return typeof content === "string" ? content.trim() : "";
  }

  const text = collectText(raw).join("\n").trim();
  if (text) return text;
  if (attachments.some((attachment) => attachment.type === "audio")) return "我收到了一段录音。";
  if (attachments.length > 0 || isImageLikeMessage(raw.msgtype)) return "\u6211\u6536\u5230\u4e86\u4e00\u5f20\u56fe\u7247\u3002";
  return "";
}

function collectText(value: unknown, path: string[] = [], output: string[] = []): string[] {
  if (typeof value === "string") {
    const key = path.at(-1)?.toLowerCase() ?? "";
    const text = value.trim();
    if (text && isTextKey(key) && !isAttachmentValue(key, text)) output.push(text);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, path, output);
    return output;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectText(item, [...path, key], output);
  }
  return [...new Set(output)];
}

function isTextKey(key: string): boolean {
  return ["content", "text", "plainText", "plaintext", "caption", "title", "markdown"].includes(key);
}

function isAttachmentValue(key: string, value: string): boolean {
  return (
    key.includes("url") ||
    key.includes("code") ||
    key.includes("media") ||
    /^https?:\/\//i.test(value) ||
    /^[A-Za-z0-9_-]{24,}$/.test(value)
  );
}

function extractAttachments(raw: RobotMessageLike): ChannelMessageAttachment[] {
  const attachments: ChannelMessageAttachment[] = [];
  visitAttachmentFields(raw, [], attachments);
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const key = attachment.url ?? attachment.downloadCode ?? attachment.mediaId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function visitAttachmentFields(value: unknown, path: string[], output: ChannelMessageAttachment[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitAttachmentFields(item, path, output);
    return;
  }

  const object = value as Record<string, unknown>;
  const attachment: ChannelMessageAttachment = { type: inferAttachmentType(object, path) };
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== "string" || !item.trim()) continue;
    const lower = key.toLowerCase();
    if (isImageUrlKey(lower) && /^https?:\/\//i.test(item)) attachment.url = item.trim();
    if (lower.includes("downloadcode")) attachment.downloadCode = item.trim();
    if (lower === "mediaid" || lower === "media_id" || lower.endsWith("mediaid")) attachment.mediaId = item.trim();
    if (["name", "filename", "fileName"].map((item) => item.toLowerCase()).includes(lower)) attachment.name = item.trim();
  }
  if (attachment.url || attachment.downloadCode || attachment.mediaId) output.push(attachment);

  for (const [key, item] of Object.entries(object)) {
    visitAttachmentFields(item, [...path, key], output);
  }
}

function inferAttachmentType(object: Record<string, unknown>, path: string[]): ChannelMessageAttachment["type"] {
  const joined = `${path.join(".")} ${Object.values(object).filter((item): item is string => typeof item === "string").join(" ")}`.toLowerCase();
  if (/\.(mp3|m4a|wav|aac|ogg|flac|amr)\b/.test(joined) || /audio|voice|录音|语音/.test(joined)) return "audio";
  if (/\.(png|jpe?g|gif|webp|bmp)\b/.test(joined) || /image|picture|pic|richtext/.test(joined)) return "image";
  return "file";
}

function isImageUrlKey(key: string): boolean {
  return key === "url" || key.includes("imageurl") || key.includes("picurl") || key.includes("pictureurl") || key.includes("downloadurl");
}

function isImageLikeMessage(msgtype: string): boolean {
  return /image|picture|richtext|file/i.test(msgtype);
}

export function startEventConsumer(options: {
  clientId: string;
  clientSecret: string;
  onEvent: (event: ChannelMessageEvent) => Promise<void>;
  onError: (error: Error) => void;
  onLog?: (message: string) => void;
}): () => void {
  const client = new DWClient({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    keepAlive: true
  });

  client.registerAllEventListener((message: DWClientDownStream) => {
    options.onLog?.(`stream event topic=${message.headers.topic} type=${message.headers.eventType ?? ""}`);
    return { status: EventAck.SUCCESS };
  });

  client.registerCallbackListener(TOPIC_ROBOT, (message: DWClientDownStream) => {
    options.onLog?.(`stream callback topic=${message.headers.topic}`);
    try {
      const robotMessage = JSON.parse(message.data) as RobotMessage;
      options.onLog?.(
        `robot message msgId=${robotMessage.msgId} conversation=${robotMessage.conversationId} senderStaffId=${robotMessage.senderStaffId} type=${robotMessage.msgtype}`
      );
      if (robotMessage.msgtype !== "text") {
        options.onLog?.(`non-text robot raw=${redactRobotMessage(message.data)}`);
      }
      void options.onEvent(mapReceiveEvent(robotMessage)).catch(options.onError);
      client.socketCallBackResponse(message.headers.messageId, { status: EventAck.SUCCESS });
    } catch (error) {
      options.onError(error as Error);
      client.socketCallBackResponse(message.headers.messageId, { status: EventAck.LATER, message: (error as Error).message });
    }
  });

  void client
    .connect()
    .then(() => options.onLog?.("dingtalk stream connected"))
    .catch(options.onError);
  return () => {
    client.disconnect();
  };
}

function redactRobotMessage(raw: string): string {
  return raw
    .replace(/("sessionWebhook"\s*:\s*")[^"]+(")/g, "$1[redacted]$2")
    .replace(/("downloadCode"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2")
    .slice(0, 2000);
}
