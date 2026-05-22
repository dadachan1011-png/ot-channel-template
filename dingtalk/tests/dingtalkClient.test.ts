import { describe, expect, it, vi } from "vitest";
import { DingTalkClient } from "../src/dingtalk/dingtalkClient.js";

describe("DingTalkClient", () => {
  it("sends text to remembered conversation webhook", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const callApi = vi.fn();
    const client = new DingTalkClient("client", "secret", "robot", "user_1", send, callApi);
    client.rememberSessionWebhook("cid_1", "https://example.test/session");

    await client.sendText("cid_1", "hello");

    expect(send).toHaveBeenCalledWith("https://example.test/session", {
      msgtype: "text",
      text: { content: "hello" }
    });
  });

  it("replies to message", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const callApi = vi.fn();
    const client = new DingTalkClient("client", "secret", "robot", "user_1", send, callApi);
    client.rememberMessageWebhook("msg_1", "https://example.test/session");

    await client.replyText("msg_1", "ok");

    expect(send).toHaveBeenCalledWith("https://example.test/session", {
      msgtype: "text",
      text: { content: "ok" }
    });
  });

  it("sends private notification through robot one-to-one API", async () => {
    const send = vi.fn();
    const callApi = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token", expireIn: 7200 })
      .mockResolvedValueOnce({});
    const client = new DingTalkClient("client", "secret", "robot_code", "user_1", send, callApi);

    await client.sendNotifyText("通知内容");

    expect(callApi).toHaveBeenNthCalledWith(1, {
      method: "POST",
      url: "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      headers: { "Content-Type": "application/json" },
      body: {
        appKey: "client",
        appSecret: "secret"
      }
    });
    expect(callApi).toHaveBeenNthCalledWith(2, {
      method: "POST",
      url: "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      headers: {
        "x-acs-dingtalk-access-token": "token",
        "Content-Type": "application/json"
      },
      body: {
        robotCode: "robot_code",
        userIds: ["user_1"],
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content: "通知内容" })
      }
    });
  });

  it("resolves robot message file download URLs", async () => {
    const send = vi.fn();
    const callApi = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token", expireIn: 7200 })
      .mockResolvedValueOnce({ downloadUrl: "https://download.example.test/image.jpg" });
    const client = new DingTalkClient("client", "secret", "robot_code", "user_1", send, callApi);

    await expect(client.getMessageFileDownloadUrl("download_code_1")).resolves.toBe("https://download.example.test/image.jpg");

    expect(callApi).toHaveBeenNthCalledWith(2, {
      method: "POST",
      url: "https://api.dingtalk.com/v1.0/robot/messageFiles/download",
      headers: {
        "x-acs-dingtalk-access-token": "token",
        "Content-Type": "application/json"
      },
      body: {
        downloadCode: "download_code_1",
        robotCode: "robot_code"
      }
    });
  });
});
