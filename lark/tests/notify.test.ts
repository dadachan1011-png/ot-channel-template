import { describe, expect, it } from "vitest";
import { formatNotification, parseNotificationPayload, splitNotificationText } from "../src/notify/server.js";

describe("parseNotificationPayload", () => {
  it("accepts valid payload", () => {
    expect(
      parseNotificationPayload({
        title: "每日检查完成",
        status: "success",
        body: "没有失败"
      })
    ).toMatchObject({
      title: "每日检查完成",
      status: "success",
      body: "没有失败"
    });
  });

  it("rejects invalid status", () => {
    expect(() =>
      parseNotificationPayload({
        title: "x",
        status: "bad",
        body: "x"
      })
    ).toThrow();
  });

  it("formats notification text", () => {
    expect(
      formatNotification({
        id: "n_1",
        title: "测试通知",
        status: "success",
        body: "通知入口可用",
        source: "local-script",
        createdAt: "now"
      })
    ).toContain("自动化结果：测试通知");
  });

  it("formats action fallback text and chunks long output", () => {
    const formatted = formatNotification({
      id: "n_2",
      title: "确认",
      status: "warning",
      body: "需要确认",
      actions: [{ label: "同意 1", value: "同意 1", style: "primary" }],
      createdAt: "now"
    });

    expect(formatted).toContain("可直接回复：");
    expect(formatted).toContain("- 同意 1");
    expect(splitNotificationText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
  });
});
