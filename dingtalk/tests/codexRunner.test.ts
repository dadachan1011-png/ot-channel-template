import { describe, expect, it } from "vitest";
import { buildCodexExecArgs, extractCodexProgress, resolveCodexSpawn } from "../src/tasks/codexRunner.js";

describe("extractCodexProgress", () => {
  it("extracts message from json event", () => {
    expect(extractCodexProgress(JSON.stringify({ type: "agent_message", message: "done" }))).toBe("done");
  });

  it("extracts final agent text from Codex item events", () => {
    expect(
      extractCodexProgress(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "OK" } }))
    ).toBe("OK");
  });

  it("returns undefined for unknown event", () => {
    expect(extractCodexProgress(JSON.stringify({ type: "other" }))).toBeUndefined();
  });

  it("builds Codex exec args with gpt-5.5 and xhigh reasoning", () => {
    expect(
      buildCodexExecArgs({
        cwd: "E:\\Projects\\active\\knowledge-base",
        prompt: "检查任务",
        model: "gpt-5.5",
        reasoningEffort: "xhigh"
      })
    ).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="xhigh"',
      "-C",
      "E:\\Projects\\active\\knowledge-base",
      "检查任务"
    ]);
  });

  it("runs a js Codex entrypoint through node", () => {
    const spawnTarget = resolveCodexSpawn({
      codexCliPath: "D:\\Tools\\codex.js",
      args: ["--version"]
    });

    expect(spawnTarget.command).toBe(process.execPath);
    expect(spawnTarget.args).toEqual(["D:\\Tools\\codex.js", "--version"]);
  });
});
