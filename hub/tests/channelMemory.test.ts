import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileMemoryContextProvider } from "../src/memory/channelMemory.js";
import { emptyState } from "../src/store/jsonStore.js";

describe("FileMemoryContextProvider", () => {
  it("stores explicit remember requests as pending candidates and applies them on command", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-memory-"));
    try {
      const memory = new FileMemoryContextProvider(root);
      const message = {
        id: "m1",
        channel: "dingtalk" as const,
        senderId: "owner",
        text: "记住：我喜欢先给结论",
        sessionKey: "dingtalk:direct:owner",
        conversationType: "direct" as const,
        receivedAt: "2026-05-19T00:00:00.000Z"
      };

      await memory.recordIncoming({ message, state: emptyState() });
      const report = await memory.buildDailyReport();

      expect(report?.body).toContain("个人记忆");
      expect(report?.body).toContain("记忆 确认");

      await memory.handleMemoryCommand?.({ ...message, text: "记忆 确认" });

      await expect(readFile(join(root, "profiles", "user.md"), "utf8")).resolves.toContain("我喜欢先给结论");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("auto-writes useful group context to group memory and can prune by daily number", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-memory-"));
    try {
      const memory = new FileMemoryContextProvider(root);
      const message = {
        id: "m2",
        channel: "dingtalk" as const,
        senderId: "member",
        text: "小曾以后默认看英文版材料，群里讨论先不要翻译成中文",
        sessionKey: "dingtalk:group:test",
        conversationType: "group" as const,
        receivedAt: new Date().toISOString()
      };

      await memory.recordIncoming({ message, state: emptyState() });
      const groupPath = join(root, "profiles", "groups", Buffer.from("dingtalk:group:test", "utf8").toString("base64url") + ".md");
      await expect(readFile(groupPath, "utf8")).resolves.toContain("小曾以后默认看英文版材料");

      const report = await memory.buildDailyReport();
      expect(report?.body).toContain("已自动写入这些群记忆");
      expect(report?.body).toContain("剔除 1");

      const reply = await memory.handleMemoryCommand?.({ ...message, text: "剔除 1" });
      expect(reply).toContain("已剔除 1 条群记忆");
      await expect(readFile(groupPath, "utf8")).resolves.not.toContain("小曾以后默认看英文版材料");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces recent relation facts as short-term context and auto group memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-memory-"));
    try {
      const memory = new FileMemoryContextProvider(root);
      const state = emptyState();
      const first = {
        id: "m3",
        channel: "dingtalk" as const,
        senderId: "member",
        text: "瑞瑞是小曾的孩子，比你聪明，会读飞书会分析录音",
        sessionKey: "dingtalk:group:test",
        conversationType: "group" as const,
        receivedAt: new Date().toISOString()
      };
      state.incomingMessages.push(first);

      await memory.recordIncoming({ message: first, state });

      const followUp = {
        ...first,
        id: "m4",
        senderId: "owner",
        text: "瑞瑞是谁"
      };
      state.incomingMessages.push(followUp);
      const context = await memory.build({ message: followUp, state });

      expect(context).toContain("短期事实线索");
      expect(context).toContain("瑞瑞是小曾的孩子");

      const groupPath = join(root, "profiles", "groups", Buffer.from("dingtalk:group:test", "utf8").toString("base64url") + ".md");
      await expect(readFile(groupPath, "utf8")).resolves.toContain("瑞瑞是小曾的孩子");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("binds self-declared group speaking style to the current sender id", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-memory-"));
    try {
      const memory = new FileMemoryContextProvider(root);
      const state = emptyState();
      const first = {
        id: "m5",
        channel: "dingtalk" as const,
        senderId: "house_sender",
        text: "以后跟我说火星文",
        sessionKey: "dingtalk:group:test",
        conversationType: "group" as const,
        receivedAt: new Date().toISOString()
      };
      state.incomingMessages.push(first);
      await memory.recordIncoming({ message: first, state });

      const followUp = {
        ...first,
        id: "m6",
        text: "你好"
      };
      state.incomingMessages.push(followUp);
      const context = await memory.build({ message: followUp, state });

      expect(context).toContain("当前发言人专属短期规则");
      expect(context).toContain("current_sender_id: house_sender");
      expect(context).toContain("跟当前发言人说话时使用火星文");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("matches group memory speaking rules by fuzzy sender nickname", async () => {
    const root = await mkdtemp(join(tmpdir(), "channel-memory-"));
    try {
      const memory = new FileMemoryContextProvider(root);
      const state = emptyState();
      const ownerMessage = {
        id: "m7",
        channel: "dingtalk" as const,
        senderId: "owner",
        senderNick: "Owner",
        text: "记住：以后跟house哥讲话要用火星文",
        sessionKey: "dingtalk:group:test",
        conversationType: "group" as const,
        receivedAt: new Date().toISOString()
      };
      state.incomingMessages.push(ownerMessage);
      await memory.recordIncoming({ message: ownerMessage, state });

      const houseMessage = {
        ...ownerMessage,
        id: "m8",
        senderId: "house_sender",
        senderNick: "伍民浩(House)",
        text: "hello"
      };
      state.incomingMessages.push(houseMessage);
      const context = await memory.build({ message: houseMessage, state });

      expect(context).toContain("当前发言人身份");
      expect(context).toContain("senderNick: 伍民浩(House)");
      expect(context).toContain("nickname_aliases");
      expect(context).toContain("当前发言人专属短期规则");
      expect(context).toContain("跟当前发言人说话时使用火星文");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
