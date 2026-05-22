import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/commands/parser.js";

describe("parseCommand", () => {
  it("parses ping", () => {
    expect(parseCommand("/ping")).toEqual({ kind: "ping" });
  });

  it("parses targeted status", () => {
    expect(parseCommand("/status Mail")).toEqual({ kind: "status", target: "Mail" });
    expect(parseCommand("查看 Mail")).toEqual({ kind: "status", target: "Mail" });
  });

  it("parses codex prompt", () => {
    expect(parseCommand("/codex 调研这个项目")).toMatchObject({
      kind: "codex",
      prompt: "调研这个项目"
    });
  });

  it("parses named codex prompt", () => {
    expect(parseCommand("/codex 名称: dingtalk桥接优化\n帮我优化体验")).toEqual({
      kind: "codex",
      name: "dingtalk桥接优化",
      prompt: "帮我优化体验"
    });
  });

  it("parses cancel", () => {
    expect(parseCommand("/cancel task_123")).toEqual({
      kind: "cancel",
      target: "task_123"
    });
  });

  it("parses cancel without task id", () => {
    expect(parseCommand("/cancel")).toEqual({ kind: "cancel" });
  });

  it("parses confirm", () => {
    expect(parseCommand("/confirm c_1 yes")).toEqual({
      kind: "confirm",
      target: "c_1",
      answer: "yes"
    });
  });

  it("parses natural approval", () => {
    expect(parseCommand("同意 1")).toEqual({
      kind: "confirm",
      target: "1",
      answer: "yes"
    });
  });

  it("parses natural rejection", () => {
    expect(parseCommand("不同意")).toEqual({
      kind: "confirm",
      answer: "no"
    });
  });

  it("parses confirm without confirmation id", () => {
    expect(parseCommand("/confirm yes")).toEqual({
      kind: "confirm",
      answer: "yes"
    });
  });

  it("parses reply", () => {
    expect(parseCommand("/reply c_1 只允许改项目配置")).toEqual({
      kind: "reply",
      target: "c_1",
      text: "只允许改项目配置"
    });
  });

  it("parses reply without confirmation id", () => {
    expect(parseCommand("/reply 只允许改项目配置")).toEqual({
      kind: "reply",
      text: "只允许改项目配置"
    });
  });

  it("parses natural reply with index", () => {
    expect(parseCommand("补充 1 只允许改项目配置")).toEqual({
      kind: "reply",
      target: "1",
      text: "只允许改项目配置"
    });
  });

  it("returns unknown for normal text", () => {
    expect(parseCommand("hello")).toEqual({ kind: "unknown", raw: "hello" });
  });
});
