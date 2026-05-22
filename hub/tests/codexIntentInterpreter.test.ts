import { describe, expect, it } from "vitest";
import { buildCodexIntentArgs, CodexIntentInterpreter } from "../src/intelligence/codexIntentInterpreter.js";
import { emptyState } from "../src/store/jsonStore.js";

describe("buildCodexIntentArgs", () => {
  it("passes the requested model and reasoning effort to Codex", () => {
    const args = buildCodexIntentArgs({
      prefix: ["../node_modules/@openai/codex/bin/codex.js"],
      schemaPath: "intent.schema.json",
      outputPath: "intent.json",
      model: "gpt-5.5",
      reasoningEffort: "medium"
    });

    expect(args).toContain("--model");
    expect(args).toContain("gpt-5.5");
    expect(args).toContain("-c");
    expect(args).toContain('model_reasoning_effort="medium"');
  });
});

describe("CodexIntentInterpreter", () => {
  it("does not call the LLM for direct confirmation commands", async () => {
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    const intent = await interpreter.interpret({
      message: message("同意 1"),
      state: emptyState()
    });

    expect(called).toBe(false);
    expect(intent).toEqual({ kind: "confirm", target: "1", answer: "yes" });
  });

  it("routes explicit Codex query wording to a Codex task without asking the LLM", async () => {
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    const intent = await interpreter.interpret({
      message: message("用 codex 查一下我目前 codex 有几个项目，并列出项目名"),
      state: emptyState()
    });

    expect(called).toBe(false);
    expect(intent.kind).toBe("codex");
    if (intent.kind === "codex") {
      expect(intent.prompt).toContain("用户原始请求");
      expect(intent.prompt).toContain("只读查询任务");
    }
  });

  it("routes SmartBI report directory requests through the registered tool without asking the planner", async () => {
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    const intent = await interpreter.interpret({
      message: message("帮我看下BI系统海外业务线下的报表目录"),
      state: emptyState()
    });

    expect(called).toBe(false);
    expect(intent.kind).toBe("codex");
    if (intent.kind === "codex") {
      expect(intent.name).toBe("查询 BI 海外业务线报表目录");
      expect(intent.prompt).toContain("smartbi_report_lookup");
      expect(intent.prompt).toContain("字段来源查询");
      expect(intent.prompt).toContain("不要输出工程流水账");
    }
  });

  it("routes natural BI field questions and bare metrics without asking the planner", async () => {
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    for (const text of ["滚动GMV可以在什么报表看到", "滚动GMV"]) {
      const intent = await interpreter.interpret({
        message: message(text),
        state: emptyState()
      });

      expect(intent.kind, text).toBe("codex");
      if (intent.kind === "codex") {
        expect(intent.name, text).toBe("查询 BI 字段来源");
        expect(intent.prompt, text).toContain("smartbi_report_lookup");
      }
    }
    expect(called).toBe(false);
  });

  it("routes business BI questions to Codex planning instead of the native keyword shortcut", async () => {
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    const intent = await interpreter.interpret({
      message: message("什么报表可以看到销售的录音链接"),
      state: emptyState()
    });

    expect(called).toBe(false);
    expect(intent.kind).toBe("codex");
    if (intent.kind === "codex") {
      expect(intent.name).toBe("查询 BI 字段来源");
      expect(intent.routeMode).toBe("planned_task");
      expect(intent.prompt).not.toContain("smartbi_report_lookup");
      expect(intent.prompt).toContain("Codex 先做业务理解");
      expect(intent.prompt).toContain("业务语义");
      expect(intent.reasoningEffort).toBe("medium");
    }
  });

  it("does not downgrade a full BI question to short follow-up fast lookup", async () => {
    const state = emptyState();
    state.incomingMessages.push(message("什么报表可以看到销售的录音链接"));
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => ({ kind: "unknown", confidence: 0 })
    });

    const intent = await interpreter.interpret({
      message: message("什么报表可以看到销售的录音链接"),
      state
    });

    expect(intent.kind).toBe("codex");
    if (intent.kind === "codex") {
      expect(intent.routeMode).toBe("planned_task");
      expect(intent.toolId).toBeUndefined();
    }
  });

  it("routes BI metric value questions to Codex planning instead of field lookup", async () => {
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    const intent = await interpreter.interpret({
      message: message("今天海外总新签GMV有多少"),
      state: emptyState()
    });

    expect(called).toBe(false);
    expect(intent.kind).toBe("codex");
    if (intent.kind === "codex") {
      expect(intent.name).toBe("查询 BI 指标数值");
      expect(intent.routeMode).toBe("planned_task");
      expect(intent.toolId).toBeUndefined();
      expect(intent.prompt).toContain("查真实数据");
      expect(intent.prompt).toContain("不要只返回报表清单");
    }
  });

  it("uses recent BI context for short field follow-ups", async () => {
    const state = emptyState();
    state.incomingMessages.push(message("这个字段可以在哪个报表看到"));
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => ({ kind: "unknown", confidence: 0 })
    });

    const intent = await interpreter.interpret({
      message: message("新签GMV"),
      state
    });

    expect(intent.kind).toBe("codex");
    if (intent.kind === "codex") {
      expect(intent.name).toBe("查询 BI 字段来源");
      expect(intent.prompt).toContain("smartbi_report_lookup");
    }
  });

  it("does not let recent BI context hijack ordinary short chat", async () => {
    const state = emptyState();
    state.incomingMessages.push(message("什么报表可以看到销售的录音链接"));
    let called = false;
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      fallback: {
        interpret: async ({ message }) => ({ kind: "assistant_reply", title: "聊天", text: `收到：${message.text}` })
      },
      intentProvider: async () => {
        called = true;
        return { kind: "unknown", confidence: 0 };
      }
    });

    const intent = await interpreter.interpret({
      message: message("今天在忙啥"),
      state
    });

    expect(called).toBe(false);
    expect(intent.kind).toBe("assistant_reply");
  });

  it("falls back to local parsing when the LLM is unavailable", async () => {
    const interpreter = new CodexIntentInterpreter({
      codexCliPath: "codex",
      timeoutMs: 1000,
      cwd: process.cwd(),
      intentProvider: async () => {
        throw new Error("LLM unavailable");
      }
    });

    const intent = await interpreter.interpret({
      message: message("查看 Mail"),
      state: emptyState()
    });

    expect(intent).toEqual({ kind: "status", target: "Mail" });
  });
});

function message(text: string) {
  return {
    id: `msg_${text}`,
    channel: "dingtalk" as const,
    senderId: "user",
    text,
    receivedAt: "2026-05-16T00:00:00.000Z"
  };
}
