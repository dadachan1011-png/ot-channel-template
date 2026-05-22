import { describe, expect, it } from "vitest";
import { OpenAiChatResponder } from "../src/intelligence/openAiChatResponder.js";
import { emptyState } from "../src/store/jsonStore.js";

function message(text: string) {
  return {
    id: "m_1",
    channel: "dingtalk" as const,
    senderId: "u_1",
    text,
    receivedAt: "2026-05-18T00:00:00.000Z"
  };
}

describe("OpenAiChatResponder", () => {
  it("uses the responses endpoint first", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify({ output_text: "你好，我是 Channel Agent。" }), { status: 200 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    const response = await responder.respond({ message: message("你是谁"), state: emptyState() });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gateway.example.com/v1/responses");
    expect(calls[0].body).toMatchObject({ model: "gpt-5.5" });
    expect(JSON.stringify(calls[0].body)).toContain("自然、清晰、轻快");
    expect(response).toEqual({ title: "回复", text: "你好，我是 Channel Agent。" });
  });

  it("falls back to chat completions when responses is unavailable", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown });
      if (calls.length === 1) return new Response("not supported", { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "已切到兼容接口。" } }] }), { status: 200 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    const response = await responder.respond({ message: message("你是谁"), state: emptyState() });

    expect(calls.map((call) => call.url)).toEqual([
      "https://gateway.example.com/v1/responses",
      "https://gateway.example.com/v1/chat/completions"
    ]);
    expect(calls[1].body).toMatchObject({ model: "gpt-5.5" });
    expect(response?.text).toBe("已切到兼容接口。");
  });

  it("hides internal memory and policy wording from normal chat replies", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output_text:
            "Sure, House哥 😄\nI can speak English with you now.\n\nBut tiny disclaimer: the group memory says I should speak Martian to you, so that is policy haunting me."
        }),
        { status: 200 }
      );

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    const response = await responder.respond({ message: message("hello"), state: emptyState() });

    expect(response?.text).toContain("House哥");
    expect(response?.text).not.toMatch(/group memory|policy|disclaimer/i);
  });

  it("does not append a suffix when base URL already points to a concrete endpoint", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ output: [{ content: [{ text: "可以。" }] }] }), { status: 200 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1/responses",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    await responder.respond({ message: message("测试"), state: emptyState() });

    expect(calls).toEqual(["https://gateway.example.com/v1/responses"]);
  });

  it("passes image URLs to the Responses API", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url) === "https://example.test/dish.jpg") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify({ output_text: "looks tasty" }), { status: 200 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    await responder.respond({
      message: {
        ...message("这是什么菜"),
        attachments: [{ type: "image", url: "https://example.test/dish.jpg" }]
      },
      state: emptyState()
    });

    expect(calls[0].url).toBe("https://gateway.example.com/v1/responses");
    expect(JSON.stringify(calls[0].body)).toContain("input_image");
    expect(JSON.stringify(calls[0].body)).toContain("data:image/jpeg;base64");
  });

  it("transcribes audio attachments before asking for analysis", async () => {
    const calls: Array<{ url: string; body?: unknown; bodyType?: string }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const target = String(url);
      if (target === "https://example.test/audio.mp3") {
        calls.push({ url: target });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      if (target.endsWith("/audio/transcriptions")) {
        calls.push({ url: target, bodyType: init?.body?.constructor.name });
        return new Response(JSON.stringify({ text: "家长希望孩子课前建立信任，也担心孩子注意力不稳定。" }), { status: 200 });
      }
      calls.push({ url: target, body: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify({ output_text: "家长需求：建立信任。优点：有共情。不足：目标确认不够。" }), { status: 200 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    const response = await responder.respond({
      message: {
        ...message("帮我分析这个课前录音"),
        attachments: [{ type: "audio", url: "https://example.test/audio.mp3", name: "课前录音.mp3" }]
      },
      state: emptyState()
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.test/audio.mp3",
      "https://gateway.example.com/v1/audio/transcriptions",
      "https://gateway.example.com/v1/responses"
    ]);
    expect(JSON.stringify(calls[2].body)).toContain("录音 1");
    expect(JSON.stringify(calls[2].body)).toContain("家长希望孩子课前建立信任");
    expect(response?.text).toContain("家长需求");
  });

  it("explains when the audio download fails before transcription", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("temporary url expired");
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    const response = await responder.respond({
      message: {
        ...message("帮我分析这个录音"),
        attachments: [{ type: "audio", url: "https://example.test/expired.mp3", name: "call.mp3" }]
      },
      state: emptyState()
    });

    expect(response?.title).toBe("录音还没转出来");
    expect(response?.text).toContain("录音下载失败");
    expect(response?.text).toContain("temporary url expired");
  });

  it("explains when the transcription endpoint is not available", async () => {
    const fetcher: typeof fetch = async (url) => {
      const target = String(url);
      if (target === "https://example.test/audio.mp3") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      return new Response(JSON.stringify({ msg: "404_NOT_FOUND" }), { status: 404 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher
    });

    const response = await responder.respond({
      message: {
        ...message("帮我分析这个录音"),
        attachments: [{ type: "audio", url: "https://example.test/audio.mp3", name: "call.mp3" }]
      },
      state: emptyState()
    });

    expect(response?.text).toContain("录音转写接口返回 HTTP 404");
    expect(response?.text).toContain("404_NOT_FOUND");
  });

  it("can use a configured local transcription command", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      const target = String(url);
      calls.push(target);
      if (target === "https://example.test/audio.mp3") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      return new Response(JSON.stringify({ output_text: "已根据本地转写完成分析" }), { status: 200 });
    };

    const responder = new OpenAiChatResponder({
      apiKey: "test",
      baseUrl: "https://gateway.example.com/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher,
      audioTranscriptionCommand: [process.execPath, "-e", "console.log('本地转写文本')"]
    });

    const response = await responder.respond({
      message: {
        ...message("帮我分析这个录音"),
        attachments: [{ type: "audio", url: "https://example.test/audio.mp3", name: "call.mp3" }]
      },
      state: emptyState()
    });

    expect(calls).toEqual(["https://example.test/audio.mp3", "https://gateway.example.com/v1/responses"]);
    expect(response?.text).toBe("已根据本地转写完成分析");
  });
});
