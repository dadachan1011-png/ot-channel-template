import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  it("loads valid config", () => {
    const config = loadConfigFromEnv({
      DINGTALK_CLIENT_ID: "ding_client",
      DINGTALK_CLIENT_SECRET: "secret",
      DINGTALK_ALLOWED_SENDER_STAFF_ID: "staff_user",
      DINGTALK_ROBOT_CODE: "robot_code",
      DINGTALK_NOTIFY_USER_ID: "notify_user",
      CODEX_CLI_PATH: "codex",
      ALLOWED_WORKSPACE_ROOT: "E:\\Projects\\active",
      STATE_FILE: ".local/state.json",
      NOTIFY_PORT: "4767",
      PROGRESS_MIN_INTERVAL_MS: "15000"
    });

    expect(config.allowedSenderStaffId).toBe("staff_user");
    expect(config.robotCode).toBe("robot_code");
    expect(config.notifyUserId).toBe("notify_user");
    expect(config.notifyPort).toBe(4767);
    expect(config.ackEnabled).toBe(false);
    expect(config.ackEmoji).toBe("");
    expect(config.typingEnabled).toBe(false);
    expect(config.typingAfterMs).toBe(5000);
    expect(config.codexModel).toBe("gpt-5.5");
    expect(config.codexReasoningEffort).toBe("medium");
  });

  it("allows missing sender id for first-message bootstrap", () => {
    const config = loadConfigFromEnv({
      DINGTALK_CLIENT_ID: "ding_client",
      DINGTALK_CLIENT_SECRET: "secret",
      DINGTALK_ROBOT_CODE: "robot_code",
      DINGTALK_NOTIFY_USER_ID: "notify_user"
    });

    expect(config.allowedSenderStaffId).toBe("");
    expect(config.notifyUserId).toBe("notify_user");
  });

  it("uses allowed sender as notification user during bootstrap", () => {
    const config = loadConfigFromEnv({
      DINGTALK_CLIENT_ID: "ding_client",
      DINGTALK_CLIENT_SECRET: "secret",
      DINGTALK_ALLOWED_SENDER_STAFF_ID: "staff_user",
      DINGTALK_ROBOT_CODE: "robot_code"
    });

    expect(config.allowedSenderStaffId).toBe("staff_user");
    expect(config.notifyUserId).toBe("staff_user");
  });
});
