import { describe, expect, it, vi } from "vitest";
import { LarkClient } from "../src/lark/larkClient.js";

describe("LarkClient", () => {
  it("sends text to chat", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const client = new LarkClient("lark-cli", run);

    await client.sendText("oc_1", "hello");

    expect(run).toHaveBeenCalledWith("lark-cli", [
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--chat-id",
      "oc_1",
      "--text",
      "hello"
    ]);
  });

  it("replies to message", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const client = new LarkClient("lark-cli", run);

    await client.replyText("om_1", "ok");

    expect(run).toHaveBeenCalledWith("lark-cli", [
      "im",
      "+messages-reply",
      "--as",
      "bot",
      "--message-id",
      "om_1",
      "--text",
      "ok"
    ]);
  });

  it("sends text to user", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const client = new LarkClient("lark-cli", run);

    await client.sendTextToUser("ou_1", "hello");

    expect(run).toHaveBeenCalledWith("lark-cli", [
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--user-id",
      "ou_1",
      "--text",
      "hello"
    ]);
  });
});
