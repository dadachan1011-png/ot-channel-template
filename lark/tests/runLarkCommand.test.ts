import { describe, expect, it } from "vitest";
import { buildLarkInvocation } from "../src/lark/runLarkCommand.js";

describe("buildLarkInvocation", () => {
  it("wraps ps1 commands with powershell on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(buildLarkInvocation("C:\\npm\\lark-cli.ps1", ["im", "hello world"])).toEqual({
        file: "powershell.exe",
        finalArgs: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "C:\\npm\\lark-cli.ps1",
          "im",
          "hello world"
        ]
      });
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
  });
});
