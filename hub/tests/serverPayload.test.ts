import { describe, expect, it } from "vitest";
import { parseConversationSummaryPayload } from "../src/server.js";

describe("parseConversationSummaryPayload", () => {
  it("accepts legacy completion summaries without a title", () => {
    const payload = parseConversationSummaryPayload({
      channel: "feishu",
      project: "foundation",
      status: "completed",
      summary: "已打开目录树。"
    });

    expect(payload.title).toBe("foundation 对话收尾摘要");
    expect(payload.project).toBe("foundation");
    expect(payload.status).toBe("completed");
  });

  it("accepts legacy snake_case decision fields", () => {
    const payload = parseConversationSummaryPayload({
      project: "channel",
      status: "blocked",
      summary: "需要处理。",
      next_actions: ["检查 Hub"],
      needs_decision: true,
      high_risk: true
    });

    expect(payload.title).toBe("channel 阻塞摘要");
    expect(payload.nextActions).toEqual(["检查 Hub"]);
    expect(payload.needsDecision).toBe(true);
    expect(payload.highRisk).toBe(true);
  });
});
