import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LarkMessageEvent } from "../domain.js";

type RawReceiveEvent = {
  event_id: string;
  message_id: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  sender_id: string;
  content: string;
  message_type: string;
  create_time: string;
};

function assertRawReceiveEvent(raw: unknown): asserts raw is RawReceiveEvent {
  const event = raw as Partial<RawReceiveEvent>;
  const required = ["event_id", "message_id", "chat_id", "chat_type", "sender_id", "content", "message_type", "create_time"];
  const missing = required.filter((key) => typeof event[key as keyof RawReceiveEvent] !== "string");
  if (missing.length > 0) {
    throw new Error(`invalid receive event payload, missing: ${missing.join(", ")}`);
  }
}

export function mapReceiveEvent(raw: unknown): LarkMessageEvent {
  assertRawReceiveEvent(raw);
  return {
    eventId: raw.event_id,
    messageId: raw.message_id,
    chatId: raw.chat_id,
    chatType: raw.chat_type,
    senderId: raw.sender_id,
    content: raw.content,
    messageType: raw.message_type,
    createTime: raw.create_time
  };
}

export function startEventConsumer(options: {
  larkCliPath: string;
  onEvent: (event: LarkMessageEvent) => Promise<void>;
  onError: (error: Error) => void;
}): () => void {
  let stderr = "";
  const eventArgs = ["event", "consume", "im.message.receive_v1", "--as", "bot"];
  const child =
    process.platform === "win32"
      ? spawn("lark-cli", eventArgs, { stdio: ["pipe", "pipe", "pipe"], shell: true })
      : spawn(options.larkCliPath, eventArgs, { stdio: ["pipe", "pipe", "pipe"] });

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    void (async () => {
      try {
        await options.onEvent(mapReceiveEvent(JSON.parse(line) as unknown));
      } catch (error) {
        options.onError(error as Error);
      }
    })();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", options.onError);
  child.on("close", (code) => {
    if (code && code !== 0) {
      options.onError(new Error(stderr || `lark event consumer exited with ${code}`));
    } else if (stderr.includes("[event] exited")) {
      options.onError(new Error(stderr));
    }
  });

  return () => {
    child.stdin.end();
  };
}
