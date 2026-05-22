import type { ChannelMessageEvent } from "../domain.js";

export type HubIncomingEnvelope = {
  type?: string;
  priority?: string;
  title: string;
  body: string;
  actions?: Array<{
    label: string;
    value: string;
    style?: "primary" | "danger" | "default";
  }>;
  metadata?: Record<string, unknown>;
};

export class HubClient {
  constructor(private readonly hubUrl: string) {}

  async forwardIncoming(event: ChannelMessageEvent): Promise<HubIncomingEnvelope | undefined> {
    const response = await fetch(`${this.hubUrl.replace(/\/$/, "")}/incoming/dingtalk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: event.eventId || event.messageId,
        senderId: event.senderStaffId,
        senderNick: event.senderNick,
        text: event.content,
        sessionKey: sessionKeyForEvent(event),
        conversationType: event.conversationType === "1" ? "direct" : "group",
        threadId: event.conversationId,
        replyToMessageId: event.messageId,
        receivedAt: new Date(Number.parseInt(event.createTime, 10) || Date.now()).toISOString(),
        attachments: event.attachments,
        raw: event
      })
    });

    if (!response.ok) {
      throw new Error(`Hub incoming forward failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as { envelope?: HubIncomingEnvelope };
    return payload.envelope;
  }
}

export function sessionKeyForEvent(event: ChannelMessageEvent): string {
  return event.conversationType === "1"
    ? `dingtalk:direct:${event.senderStaffId}`
    : `dingtalk:group:${event.conversationId}`;
}
