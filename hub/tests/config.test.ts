import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults intent interpretation to gpt-5.5 with medium reasoning", () => {
    const config = loadConfig({});

    expect(config.intentModel).toBe("gpt-5.5");
    expect(config.intentReasoningEffort).toBe("medium");
  });

  it("loads explicit intent reasoning effort", () => {
    const config = loadConfig({ HUB_INTENT_REASONING_EFFORT: "high" });

    expect(config.intentReasoningEffort).toBe("high");
  });
});
