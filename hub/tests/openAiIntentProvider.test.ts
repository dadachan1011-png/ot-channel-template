import { describe, expect, it } from "vitest";
import { OpenAiIntentProvider } from "../src/intelligence/openAiIntentProvider.js";
import { emptyState } from "../src/store/jsonStore.js";

describe("OpenAiIntentProvider", () => {
  it("parses JSON planner output from chat fallback", async () => {
    const requestedUrls: string[] = [];
    const provider = new OpenAiIntentProvider({
      apiKey: "test",
      baseUrl: "https://llm.example/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      maxRetries: 0,
      fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrls.push(String(url));
        if (String(url).endsWith("/responses")) return new Response("{}", { status: 400 });
        const body = JSON.parse(String(init?.body));
        expect(body.response_format).toEqual({ type: "json_object" });
        expect(body.messages[1].content).toContain("只输出一个 JSON 对象");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    kind: "codex",
                    confidence: 0.9,
                    target: null,
                    abnormalOnly: false,
                    prompt: "执行查询",
                    name: "查询 BI",
                    answer: null,
                    replyText: null,
                    routeChannel: null,
                    persistent: false,
                    quietScope: null,
                    responseTitle: null,
                    responseText: null
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch
    });

    const result = await provider.provide({
      message: {
        id: "m1",
        channel: "dingtalk",
        senderId: "u1",
        text: "帮我看下BI系统上海外业务线下的报表目录",
        receivedAt: "2026-05-19T00:00:00.000Z"
      },
      state: emptyState(),
      prompt: "base planner prompt"
    });

    expect(requestedUrls).toEqual(["https://llm.example/v1/responses", "https://llm.example/v1/chat/completions"]);
    expect(result).toMatchObject({ kind: "codex", prompt: "执行查询", name: "查询 BI" });
  });
});
