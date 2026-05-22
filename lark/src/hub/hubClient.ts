import type { LarkMessageEvent } from "../domain.js";

export type HubIncomingEnvelope = {
  title: string;
  body: string;
};

export class HubClient {
  constructor(private readonly hubUrl: string) {}

  async forwardIncoming(event: LarkMessageEvent): Promise<HubIncomingEnvelope | undefined> {
    const response = await fetch(`${this.hubUrl.replace(/\/$/, "")}/incoming/lark`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: event.eventId || event.messageId,
        senderId: event.senderId,
        text: event.content,
        sessionKey: sessionKeyForEvent(event),
        conversationType: event.chatType === "p2p" ? "direct" : "group",
        threadId: event.chatId,
        replyToMessageId: event.messageId,
        receivedAt: new Date(Number.parseInt(event.createTime, 10) || Date.now()).toISOString(),
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

export function sessionKeyForEvent(event: LarkMessageEvent): string {
  return event.chatType === "p2p" ? `lark:direct:${event.senderId}` : `lark:group:${event.chatId}`;
}
