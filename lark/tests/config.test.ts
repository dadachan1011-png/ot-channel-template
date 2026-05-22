import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  it("loads valid config", () => {
    const config = loadConfigFromEnv({
      LARK_ALLOWED_OPEN_ID: "ou_user",
      LARK_NOTIFY_USER_ID: "ou_user",
      LARK_CLI_PATH: "lark-cli",
      CODEX_CLI_PATH: "codex",
      ALLOWED_WORKSPACE_ROOT: "E:\\Projects\\active",
      STATE_FILE: ".local/state.json",
      NOTIFY_PORT: "4766",
      PROGRESS_MIN_INTERVAL_MS: "15000"
    });

    expect(config.allowedOpenId).toBe("ou_user");
    expect(config.notifyUserId).toBe("ou_user");
    expect(config.notifyPort).toBe(4766);
    expect(config.ackEnabled).toBe(true);
    expect(config.ackEmoji).toBe("👀");
    expect(config.typingEnabled).toBe(true);
    expect(config.typingAfterMs).toBe(5000);
    expect(config.codexModel).toBe("gpt-5.5");
    expect(config.codexReasoningEffort).toBe("medium");
  });

  it("rejects missing allowed open id", () => {
    expect(() => loadConfigFromEnv({ LARK_NOTIFY_USER_ID: "ou_user" })).toThrow(/LARK_ALLOWED_OPEN_ID/);
  });

  it("requires a notification target", () => {
    expect(() => loadConfigFromEnv({ LARK_ALLOWED_OPEN_ID: "ou_user" })).toThrow(/LARK_NOTIFY_CHAT_ID/);
  });
});
