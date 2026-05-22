import { describe, expect, it } from "vitest";
import { mapReceiveEvent } from "../src/lark/eventConsumer.js";

describe("mapReceiveEvent", () => {
  it("maps lark-cli receive event", () => {
    expect(
      mapReceiveEvent({
        event_id: "e_1",
        message_id: "om_1",
        chat_id: "oc_1",
        chat_type: "p2p",
        sender_id: "ou_1",
        content: "/ping",
        message_type: "text",
        create_time: "123"
      })
    ).toEqual({
      eventId: "e_1",
      messageId: "om_1",
      chatId: "oc_1",
      chatType: "p2p",
      senderId: "ou_1",
      content: "/ping",
      messageType: "text",
      createTime: "123"
    });
  });

  it("rejects invalid receive event payload", () => {
    expect(() =>
      mapReceiveEvent({
        ok: false
      } as never)
    ).toThrow();
  });
});
