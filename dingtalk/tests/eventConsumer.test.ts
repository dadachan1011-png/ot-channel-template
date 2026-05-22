import { describe, expect, it } from "vitest";
import { mapReceiveEvent } from "../src/dingtalk/eventConsumer.js";

describe("mapReceiveEvent", () => {
  it("maps DingTalk robot text event", () => {
    expect(
      mapReceiveEvent({
        conversationId: "cid_1",
        chatbotCorpId: "corp",
        chatbotUserId: "bot",
        msgId: "msg_1",
        senderNick: "ExampleUser",
        isAdmin: true,
        senderStaffId: "staff_1",
        sessionWebhookExpiredTime: 123456,
        createAt: 123,
        senderCorpId: "corp",
        conversationType: "1",
        senderId: "sender_1",
        sessionWebhook: "https://example.test/session",
        robotCode: "robot",
        msgtype: "text",
        text: { content: " /ping " }
      })
    ).toEqual({
      eventId: "msg_1",
      messageId: "msg_1",
      conversationId: "cid_1",
      conversationType: "1",
      senderId: "sender_1",
      senderStaffId: "staff_1",
      senderNick: "ExampleUser",
      content: "/ping",
      messageType: "text",
      createTime: "123",
      sessionWebhook: "https://example.test/session",
      robotCode: "robot",
      raw: expect.any(Object)
    });
  });

  it("maps DingTalk richText image event with caption and attachment", () => {
    expect(
      mapReceiveEvent({
        conversationId: "cid_1",
        chatbotCorpId: "corp",
        chatbotUserId: "bot",
        msgId: "msg_2",
        senderNick: "ExampleUser",
        isAdmin: true,
        senderStaffId: "staff_1",
        sessionWebhookExpiredTime: 123456,
        createAt: 123,
        senderCorpId: "corp",
        conversationType: "2",
        senderId: "sender_1",
        sessionWebhook: "https://example.test/session",
        robotCode: "robot",
        msgtype: "richText",
        richText: {
          content: [
            { type: "text", text: "check this image" },
            { type: "picture", imageUrl: "https://example.test/a.jpg", downloadCode: "download_code_1" }
          ]
        }
      } as never)
    ).toMatchObject({
      eventId: "msg_2",
      content: "check this image",
      messageType: "richText",
      attachments: [
        {
          type: "image",
          url: "https://example.test/a.jpg",
          downloadCode: "download_code_1"
        }
      ],
      raw: expect.any(Object)
    });
  });

  it("uses an image placeholder when a richText image has no readable text", () => {
    expect(
      mapReceiveEvent({
        conversationId: "cid_1",
        chatbotCorpId: "corp",
        chatbotUserId: "bot",
        msgId: "msg_3",
        senderNick: "ExampleUser",
        isAdmin: true,
        senderStaffId: "staff_1",
        sessionWebhookExpiredTime: 123456,
        createAt: 123,
        senderCorpId: "corp",
        conversationType: "2",
        senderId: "sender_1",
        sessionWebhook: "https://example.test/session",
        robotCode: "robot",
        msgtype: "richText",
        richText: {
          content: [{ type: "picture", downloadCode: "download_code_1" }]
        }
      } as never)
    ).toMatchObject({
      content: "我收到了一张图片。",
      attachments: [{ type: "image", downloadCode: "download_code_1" }]
    });
  });

  it("maps DingTalk audio file attachments", () => {
    expect(
      mapReceiveEvent({
        conversationId: "cid_1",
        chatbotCorpId: "corp",
        chatbotUserId: "bot",
        msgId: "msg_4",
        senderNick: "ExampleUser",
        isAdmin: true,
        senderStaffId: "staff_1",
        sessionWebhookExpiredTime: 123456,
        createAt: 123,
        senderCorpId: "corp",
        conversationType: "2",
        senderId: "sender_1",
        sessionWebhook: "https://example.test/session",
        robotCode: "robot",
        msgtype: "file",
        content: {
          fileName: "call.mp3",
          downloadCode: "download_code_audio"
        }
      } as never)
    ).toMatchObject({
      content: "我收到了一段录音。",
      attachments: [
        {
          type: "audio",
          name: "call.mp3",
          downloadCode: "download_code_audio"
        }
      ]
    });
  });
});

