import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/commands/parser.js";

describe("parseCommand", () => {
  it("parses ping commands", () => {
    expect(parseCommand("ping")).toEqual({ kind: "ping" });
    expect(parseCommand("/ping")).toEqual({ kind: "ping" });
  });

  it("parses shared natural-language confirmation commands", () => {
    expect(parseCommand("同意")).toEqual({ kind: "confirm", answer: "yes" });
    expect(parseCommand("同意 1")).toEqual({ kind: "confirm", target: "1", answer: "yes" });
    expect(parseCommand("不同意 Mail")).toEqual({ kind: "confirm", target: "Mail", answer: "no" });
  });

  it("parses shared status, reply, cancel, and routing commands", () => {
    expect(parseCommand("今天有什么异常")).toEqual({ kind: "status", abnormalOnly: true });
    expect(parseCommand("补充 1 只允许改文档")).toEqual({ kind: "reply", target: "1", text: "只允许改文档" });
    expect(parseCommand("取消这个任务")).toEqual({ kind: "cancel" });
    expect(parseCommand("这条发飞书归档")).toEqual({ kind: "route", channel: "lark", persistent: false });
    expect(parseCommand("这个双发")).toEqual({ kind: "route", channel: "both", persistent: false });
  });

  it("parses channel doctor commands", () => {
    expect(parseCommand("渠道状态")).toEqual({ kind: "channels_status" });
    expect(parseCommand("/channels status")).toEqual({ kind: "channels_status" });
    expect(parseCommand("/doctor")).toEqual({ kind: "channels_status" });
    expect(parseCommand("诊断")).toEqual({ kind: "channels_status" });
  });
});
