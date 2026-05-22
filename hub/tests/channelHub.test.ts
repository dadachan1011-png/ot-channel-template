import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelRegistry } from "../src/adapters/registry.js";
import { RecordingAdapter } from "../src/adapters/recordingAdapter.js";
import type { DeliveryResult, OutgoingChannelMessage } from "../src/domain.js";
import { ChannelHub } from "../src/hub/channelHub.js";
import { CodexIntentInterpreter, RuleBasedIntentInterpreter } from "../src/intelligence/codexIntentInterpreter.js";
import { FileMemoryContextProvider } from "../src/memory/channelMemory.js";
import { emptyState } from "../src/store/jsonStore.js";
import type { IntentInterpreter } from "../src/intelligence/intent.js";

process.env.BI_KNOWLEDGE_FILES = join(process.cwd(), "tests", "fixtures", "bi_report_knowledge.json");

function createHub(interpreter?: IntentInterpreter) {
  const registry = new ChannelRegistry();
  const dingtalk = new RecordingAdapter("dingtalk");
  const lark = new RecordingAdapter("lark");
  registry.register(dingtalk);
  registry.register(lark);
  const hub = new ChannelHub({ state: emptyState(), registry, interpreter, now: () => new Date("2026-05-16T00:00:00.000Z") });
  return { hub, dingtalk, lark };
}

function createHubWithProjectContext(interpreter?: IntentInterpreter) {
  const registry = new ChannelRegistry();
  const dingtalk = new RecordingAdapter("dingtalk");
  const lark = new RecordingAdapter("lark");
  registry.register(dingtalk);
  registry.register(lark);
  const hub = new ChannelHub({
    state: emptyState(),
    registry,
    interpreter,
    now: () => new Date("2026-05-16T00:00:00.000Z"),
    projectContext: {
      findProject: (target: string) => {
        if (target === "knowledge-base") {
          return {
              name: "knowledge-base",
              path: "E:\\Projects\\active\\knowledge-base",
              runningProcesses: [
                {
                  pid: 56328,
                  name: "python.exe",
                  commandLine: "python scripts\\extract_feishu_learning_packages.py --limit 3"
                }
              ]
            };
        }
        if (target === "foundation") {
          return {
            name: "foundation",
            path: "E:\\Projects\\active\\foundation",
            runningProcesses: []
          };
        }
        return undefined;
      }
    }
  });
  return { hub, dingtalk, lark };
}

class FailingAdapter {
  readonly sent: OutgoingChannelMessage[] = [];

  constructor(readonly name: "dingtalk" | "lark") {}

  async send(message: OutgoingChannelMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return { ok: false, error: `${this.name} unavailable` };
  }
}

describe("ChannelHub", () => {
  it("executes SmartBI lookup as a native hub tool instead of creating a Codex task", async () => {
    const { hub, dingtalk } = createHub({
      interpret: async () => ({
        kind: "codex",
        name: "查询 BI 海外业务线报表目录",
        routeMode: "fast_lookup",
        toolId: "smartbi_report_lookup",
        prompt: "你正在通过 Channel Hub 的注册工具能力执行任务：smartbi_report_lookup（SmartBI 报表目录查询）。"
      })
    });

    const envelope = await hub.handleIncoming({
      id: "msg_smartbi",
      channel: "dingtalk",
      senderId: "owner",
      text: "帮我看下BI系统上海外业务线下的报表目录",
      receivedAt: "2026-05-16T00:00:00.000Z"
    });

    expect(envelope?.type).toBe("chat");
    expect(envelope?.title).toBe("BI 报表目录");
    expect(envelope?.body).toContain("查到了");
    expect(hub.getState().tasks).toHaveLength(0);
    expect(dingtalk.sent[0]?.body).toContain("一级目录");
  });

  it("blocks privileged actions from non-owner senders", async () => {
    const registry = new ChannelRegistry();
    const dingtalk = new RecordingAdapter("dingtalk");
    registry.register(dingtalk);
    const hub = new ChannelHub({
      state: emptyState(),
      registry,
      privilegedSenderId: "owner",
      interpreter: {
        interpret: async () => ({ kind: "codex", prompt: "检查项目", name: "检查项目" })
      },
      now: () => new Date("2026-05-16T00:00:00.000Z")
    });

    await hub.handleIncoming({
      id: "msg_unprivileged",
      channel: "dingtalk",
      senderId: "other",
      text: "检查项目",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(hub.getState().tasks).toHaveLength(0);
    expect(dingtalk.sent[0].body).toContain("owner");
  });

  it("blocks non-owner group members from creating planned link review tasks", async () => {
    const registry = new ChannelRegistry();
    const dingtalk = new RecordingAdapter("dingtalk");
    registry.register(dingtalk);
    const hub = new ChannelHub({
      state: emptyState(),
      registry,
      privilegedSenderId: "owner",
      interpreter: new CodexIntentInterpreter({
        codexCliPath: "codex",
        timeoutMs: 1000,
        cwd: process.cwd(),
        intentProvider: async () => ({ kind: "unknown", confidence: 0 })
      }),
      feishuDocumentAnalysis: {},
      now: () => new Date("2026-05-16T00:00:00.000Z")
    });

    await hub.handleIncoming({
      id: "msg_link_review",
      channel: "dingtalk",
      senderId: "group_member",
      text: "https://my.feishu.cn/wiki/NnClwh6gjiBp9CkrlVWcx4sfn88 @机器人 你能打开这个飞书链接，帮我看看他的逻辑有没有问题吗",
      conversationType: "group",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(hub.getState().tasks).toHaveLength(0);
    expect(dingtalk.sent[0].body).toContain("owner");
  });

  it("sends normal confirmations to DingTalk and allows Lark to resolve them", async () => {
    const { hub, dingtalk, lark } = createHub();

    await hub.createConfirmation({
      title: "是否允许修改项目配置",
      body: "影响：会改项目配置",
      requestedBy: "automation"
    });

    expect(dingtalk.sent).toHaveLength(1);
    expect(lark.sent).toHaveLength(0);

    await hub.handleIncoming({
      id: "msg_1",
      channel: "lark",
      senderId: "user",
      text: "同意",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(hub.getState().confirmations[0].status).toBe("approved");
    expect(hub.getState().confirmations[0].resolvedByChannel).toBe("lark");
  });

  it("asks for a target when bare approval is ambiguous", async () => {
    const { hub, lark } = createHub();

    await hub.createConfirmation({ title: "确认 A", body: "A", requestedBy: "automation" });
    await hub.createConfirmation({ title: "确认 B", body: "B", requestedBy: "automation" });
    await hub.handleIncoming({
      id: "msg_2",
      channel: "lark",
      senderId: "user",
      text: "同意",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(hub.getState().confirmations.every((item) => item.status === "pending")).toBe(true);
    expect(lark.sent.at(-1)?.body).toContain("请回复：同意 1 / 同意 2");
  });

  it("explains how to communicate when the message is unknown", async () => {
    const { hub, dingtalk } = createHub();

    await hub.handleIncoming({
      id: "msg_3",
      channel: "dingtalk",
      senderId: "user",
      text: "处理一下那个",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.title).toBe("我没理解这条消息");
    expect(dingtalk.sent.at(-1)?.body).toContain("可以这样表达");
    expect(dingtalk.sent.at(-1)?.body).toContain("同意 1");
  });

  it("keeps task progress in the starting channel for normal task replies", async () => {
    const { hub, dingtalk, lark } = createHub();

    await hub.handleIncoming({
      id: "msg_4",
      channel: "lark",
      senderId: "user",
      text: "/codex 名称: Mail 检查; 检查今天异常",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(lark.sent.at(-1)?.title).toBe("已创建任务：Mail 检查");
    expect(dingtalk.sent).toHaveLength(0);
  });

  it("uses medium reasoning by default and escalates complex Codex tasks", async () => {
    const simple = createHub({
      interpret: async () => ({ kind: "codex", prompt: "list files", name: "list files" })
    });
    await simple.hub.handleIncoming({
      id: "msg_simple_reasoning",
      channel: "dingtalk",
      senderId: "user",
      text: "list files",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });
    expect(simple.dingtalk.sent.at(-1)?.metadata?.reasoningEffort).toBe("medium");

    const complex = createHub({
      interpret: async () => ({ kind: "codex", prompt: "深入分析架构风险并跑测试", name: "架构分析" })
    });
    await complex.hub.handleIncoming({
      id: "msg_complex_reasoning",
      channel: "dingtalk",
      senderId: "user",
      text: "深入分析架构风险并跑测试",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });
    expect(complex.dingtalk.sent.at(-1)?.metadata?.reasoningEffort).toBe("high");
  });

  it("honors explicit Codex reasoning effort from the interpreter", async () => {
    const { hub, dingtalk } = createHub({
      interpret: async () => ({ kind: "codex", prompt: "use maximum reasoning", name: "max", reasoningEffort: "xhigh" })
    });

    await hub.handleIncoming({
      id: "msg_explicit_reasoning",
      channel: "dingtalk",
      senderId: "user",
      text: "use maximum reasoning",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.metadata?.reasoningEffort).toBe("xhigh");
  });

  it("routes completed conversation summaries to Lark", async () => {
    const { hub, dingtalk, lark } = createHub();

    await hub.syncConversationSummary({
      title: "任务完成摘要",
      project: "channel-hub",
      status: "completed",
      summary: "完成普通项目更新。"
    });

    expect(lark.sent).toHaveLength(1);
    expect(lark.sent[0].title).toBe("任务完成摘要");
    expect(dingtalk.sent).toHaveLength(0);
    expect(hub.getState().conversationSummaries).toHaveLength(1);
  });

  it("routes failed or decision-needed summaries to DingTalk", async () => {
    const { hub, dingtalk, lark } = createHub();

    await hub.syncConversationSummary({
      title: "需要处理的摘要",
      status: "failed",
      summary: "任务失败，需要处理。",
      needsDecision: true,
      nextActions: ["查看失败原因"]
    });

    expect(dingtalk.sent).toHaveLength(1);
    expect(dingtalk.sent[0].body).toContain("需要你处理：是");
    expect(lark.sent).toHaveLength(0);
  });

  it("double-sends high-risk summaries", async () => {
    const { hub, dingtalk, lark } = createHub();

    await hub.syncConversationSummary({
      title: "高风险摘要",
      status: "blocked",
      summary: "涉及长期配置变更。",
      highRisk: true
    });

    expect(dingtalk.sent).toHaveLength(1);
    expect(lark.sent).toHaveLength(1);
  });

  it("does not loop fallback delivery when all channels fail", async () => {
    const registry = new ChannelRegistry();
    const dingtalk = new FailingAdapter("dingtalk");
    const lark = new FailingAdapter("lark");
    registry.register(dingtalk);
    registry.register(lark);
    const hub = new ChannelHub({ state: emptyState(), registry, now: () => new Date("2026-05-16T00:00:00.000Z") });

    await hub.syncConversationSummary({
      title: "任务完成摘要",
      project: "foundation",
      status: "completed",
      summary: "完成普通项目更新。"
    });

    expect(lark.sent).toHaveLength(1);
    expect(dingtalk.sent).toHaveLength(1);
    expect(hub.getState().deliveryAttempts.map((item) => item.channel)).toEqual(["lark", "dingtalk"]);
  });

  it("can use an LLM interpreter to turn natural phrasing into an action", async () => {
    const interpreter: IntentInterpreter = {
      async interpret() {
        return { kind: "status", abnormalOnly: true };
      }
    };
    const { hub, lark } = createHub(interpreter);

    await hub.handleIncoming({
      id: "msg_llm_1",
      channel: "lark",
      senderId: "user",
      text: "帮我看下现在有没有卡住的",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(lark.sent.at(-1)?.title).toBe("当前状态");
    expect(lark.sent.at(-1)?.body).toContain("今日异常/待处理");
  });

  it("can use an LLM interpreter to provide a conversational reply", async () => {
    const interpreter: IntentInterpreter = {
      async interpret() {
        return {
          kind: "assistant_reply",
          title: "我会按自然语言理解",
          text: "收到。以后你可以直接说目标，我会判断是查询、确认、取消、追问还是路由。"
        };
      }
    };
    const { hub, dingtalk } = createHub(interpreter);

    await hub.handleIncoming({
      id: "msg_llm_2",
      channel: "dingtalk",
      senderId: "user",
      text: "你这样太死板了",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.title).toBe("我会按自然语言理解");
    expect(dingtalk.sent.at(-1)?.body).toContain("直接说目标");
  });

  it("routes assistant replies through memory-backed chat when the current group sender has matched memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-hub-memory-route-"));
    try {
      const state = emptyState();
      const registry = new ChannelRegistry();
      const dingtalk = new RecordingAdapter("dingtalk");
      registry.register(dingtalk);
      const memory = new FileMemoryContextProvider(root);

      await memory.recordIncoming({
        message: {
          id: "msg_memory_seed",
          channel: "dingtalk",
          senderId: "owner",
          senderNick: "Owner",
          text: "记住以后跟house哥讲话只能说火星文",
          sessionKey: "dingtalk:group:test",
          conversationType: "group",
          receivedAt: "2026-05-16T00:00:00.000Z"
        },
        state
      });

      let chatCalled = false;
      const hub = new ChannelHub({
        state,
        registry,
        memoryRecorder: memory,
        chatResponder: {
          async respond() {
            chatCalled = true;
            return { title: "回复", text: "火星文规则已套用" };
          }
        },
        interpreter: {
          async interpret() {
            return { kind: "assistant_reply", title: "普通回复", text: "你好，我在。" };
          }
        },
        now: () => new Date("2026-05-16T00:00:01.000Z")
      });

      await hub.handleIncoming({
        id: "msg_house_hi",
        channel: "dingtalk",
        senderId: "house_sender",
        senderNick: "House",
        text: "你好",
        sessionKey: "dingtalk:group:test",
        conversationType: "group",
        receivedAt: "2026-05-16T00:00:01.000Z"
      });

      expect(chatCalled).toBe(true);
      expect(dingtalk.sent.at(-1)?.body).toBe("火星文规则已套用");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("understands common natural speech without calling Codex", async () => {
    const { hub, lark } = createHub(new RuleBasedIntentInterpreter());

    await hub.handleIncoming({
      id: "msg_semantic_1",
      channel: "lark",
      senderId: "user",
      text: "帮我看下现在有没有卡住的",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(lark.sent.at(-1)?.title).toBe("当前状态");
    expect(lark.sent.at(-1)?.body).toContain("今日异常/待处理");
  });

  it("reports channel doctor status", async () => {
    const { hub, dingtalk } = createHub(new RuleBasedIntentInterpreter());

    await hub.handleIncoming({
      id: "msg_channel_status",
      channel: "dingtalk",
      senderId: "user",
      text: "渠道状态",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.title).toBe("Doctor 诊断");
    expect(dingtalk.sent.at(-1)?.body).toContain("Hub：在线");
    expect(dingtalk.sent.at(-1)?.body).toContain("活跃任务：0");
    expect(dingtalk.sent.at(-1)?.body).toContain("待确认 memory：0");
    expect(dingtalk.sent.at(-1)?.body).toContain("dingtalk：可通知");
  });

  it("understands project status questions without Codex", async () => {
    const { hub, dingtalk } = createHub(new RuleBasedIntentInterpreter());
    await hub.syncConversationSummary({
      title: "knowledge-base 学习进度",
      project: "knowledge-base",
      status: "completed",
      summary: "最近一次学习任务已完成，后续需要补齐钉钉正文读取。",
      nextActions: ["继续验证钉钉登录态读取"]
    });
    dingtalk.sent.length = 0;

    await hub.handleIncoming({
      id: "msg_project_status",
      channel: "dingtalk",
      senderId: "user",
      text: "knowledge-base 运行的怎么样了",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.title).toBe("当前状态");
    expect(dingtalk.sent.at(-1)?.body).toContain("项目：knowledge-base");
    expect(dingtalk.sent.at(-1)?.body).toContain("最近一次学习任务已完成");
  });

  it("maps knowledge-base to Chinese knowledge-base summaries", async () => {
    const { hub, dingtalk } = createHub(new RuleBasedIntentInterpreter());
    await hub.syncConversationSummary({
      title: "业务知识库全量学习进度更新",
      status: "completed",
      summary: "飞书学习包累计729个，成功716个。",
      nextActions: ["继续补齐钉钉正文读取"]
    });
    dingtalk.sent.length = 0;

    await hub.handleIncoming({
      id: "msg_project_alias_status",
      channel: "dingtalk",
      senderId: "user",
      text: "knowledge-base 运行的怎么样了",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.body).toContain("项目：业务知识库全量学习进度更新");
    expect(dingtalk.sent.at(-1)?.body).toContain("飞书学习包累计729个");
  });

  it("uses local project context for plain runtime status questions", async () => {
    const { hub, dingtalk } = createHubWithProjectContext(new RuleBasedIntentInterpreter());

    await hub.handleIncoming({
      id: "msg_project_process_status",
      channel: "dingtalk",
      senderId: "user",
      text: "knowledge-base运行怎么样了",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.title).toBe("当前状态");
    expect(dingtalk.sent.at(-1)?.body).toContain("项目：knowledge-base");
    expect(dingtalk.sent.at(-1)?.body).toContain("状态：running");
    expect(dingtalk.sent.at(-1)?.body).toContain("python.exe 56328");
    expect(dingtalk.sent.at(-1)?.body).toContain("extract_feishu_learning_packages.py --limit 3");
  });

  it("prefers current local project context over an older project summary for plain runtime status", async () => {
    const { hub, dingtalk } = createHubWithProjectContext(new RuleBasedIntentInterpreter());
    await hub.syncConversationSummary({
      title: "knowledge-base 昨日摘要",
      project: "knowledge-base",
      status: "completed",
      summary: "昨日学习任务已完成。"
    });
    dingtalk.sent.length = 0;

    await hub.handleIncoming({
      id: "msg_project_process_over_summary",
      channel: "dingtalk",
      senderId: "user",
      text: "knowledge-base运行怎么样了",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.body).toContain("状态：running");
    expect(dingtalk.sent.at(-1)?.body).toContain("extract_feishu_learning_packages.py --limit 3");
    expect(dingtalk.sent.at(-1)?.body).not.toContain("昨日学习任务已完成");
  });

  it("attaches text fallback actions to confirmations", async () => {
    const { hub, dingtalk } = createHub();

    await hub.createConfirmation({
      title: "是否允许修改项目配置",
      body: "影响：会改项目配置",
      requestedBy: "automation"
    });

    expect(dingtalk.sent[0].actions?.map((action) => action.value)).toEqual([
      "同意 1",
      "不同意 1",
      "补充 1 ",
      "取消 1"
    ]);
  });

  it("turns conversational feedback into a useful reply without fixed commands", async () => {
    const { hub, dingtalk } = createHub(new RuleBasedIntentInterpreter());

    await hub.handleIncoming({
      id: "msg_semantic_2",
      channel: "dingtalk",
      senderId: "user",
      text: "你这对话太死板了，我不想记命令",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    expect(dingtalk.sent.at(-1)?.title).toBe("我会按自然语言理解");
    expect(dingtalk.sent.at(-1)?.body).toContain("不用记固定命令");
  });

  it("turns project review requests into executable Codex tasks", async () => {
    const { hub, dingtalk } = createHubWithProjectContext(new RuleBasedIntentInterpreter());

    await hub.handleIncoming({
      id: "msg_project_review_task",
      channel: "dingtalk",
      senderId: "user",
      text: "帮我看看foundation项目模块设计的完整性",
      receivedAt: "2026-05-16T00:00:01.000Z"
    });

    const sent = dingtalk.sent.at(-1);
    expect(sent?.title).toContain("已创建任务");
    expect(sent?.body).toContain("状态：running");
    expect(sent?.metadata?.codexPrompt).toContain("foundation");
    expect(sent?.metadata?.codexPrompt).toContain("模块设计");
    expect(sent?.metadata?.cwd).toBe("E:\\Projects\\active\\foundation");
  });

  it("turns 10 project progress and ETA requests into evidence-based Codex investigation tasks", async () => {
    const cases = [
      "帮我看看knowledge-base项目开发进度，还要多久才能完成全部",
      "帮我看看knowledge-base项目开发进度，还要多久才能完成全部任务",
      "knowledge-base项目现在开发到哪了，剩下多久",
      "查一下knowledge-base还差哪些任务没做完，预计多久结束",
      "帮我评估knowledge-base项目离完成还有多远",
      "看下knowledge-base当前进展和剩余工作量",
      "帮我看看knowledge-base项目下在跑的会话，还要多久才能完成全部任务",
      "检查knowledge-base的任务进度、阻塞和预计完成时间",
      "knowledge-base现在是不是快做完了，给我证据和ETA",
      "帮我判断knowledge-base开发完成度，剩余任务和风险"
    ];

    for (const [index, text] of cases.entries()) {
      const { hub, dingtalk } = createHubWithProjectContext(new RuleBasedIntentInterpreter());

      await hub.handleIncoming({
        id: `msg_progress_quality_${index}`,
        channel: "dingtalk",
        senderId: "user",
        text,
        receivedAt: "2026-05-16T00:00:01.000Z"
      });

      const sent = dingtalk.sent.at(-1);
      const prompt = String(sent?.metadata?.codexPrompt ?? "");
      expect(sent?.title, text).toContain("已创建任务");
      expect(sent?.body, text).toContain("状态：running");
      expect(sent?.metadata?.cwd, text).toBe("E:\\Projects\\active\\knowledge-base");
      expect(prompt, text).toContain("knowledge-base");
      expect(prompt, text).toContain("开发进度评估");
      expect(prompt, text).toContain("已完成");
      expect(prompt, text).toContain("未完成");
      expect(prompt, text).toContain("预计还需要多久");
      expect(prompt, text).toContain("证据");
      expect(prompt, text).toContain("风险");
      expect(prompt, text).toContain("下一步");
      expect(prompt, text).toContain("不要修改文件");
    }
  });
});
