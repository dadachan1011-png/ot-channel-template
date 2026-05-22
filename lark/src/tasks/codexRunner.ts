import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { BridgeTask } from "../domain.js";

export function extractCodexProgress(line: string): string | undefined {
  const event = JSON.parse(line) as { type?: string; message?: string; text?: string };
  if (event.type === "agent_message" && event.message) return event.message;
  if (event.type === "message" && event.text) return event.text;
  return undefined;
}

export function buildCodexExecArgs(input: { cwd: string; prompt: string; model?: string; reasoningEffort?: string }): string[] {
  const args = ["exec", "--json"];
  if (input.model) args.push("--model", input.model);
  if (input.reasoningEffort) args.push("-c", `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`);
  args.push("-C", input.cwd, input.prompt);
  return args;
}

export class CodexRunner {
  private currentProcess: ChildProcessWithoutNullStreams | undefined;
  private currentTaskId: string | undefined;

  constructor(
    private readonly codexCliPath: string,
    private readonly options: { model?: string; reasoningEffort?: string } = {}
  ) {}

  getCurrentTaskId(): string | undefined {
    return this.currentTaskId;
  }

  runTask(options: {
    task: BridgeTask;
    onProgress: (text: string) => Promise<void>;
    onComplete: (text: string) => Promise<void>;
    onFailure: (error: Error) => Promise<void>;
  }): void {
    const child = spawn(
      this.codexCliPath,
      buildCodexExecArgs({
        cwd: options.task.cwd,
        prompt: options.task.prompt,
        model: this.options.model,
        reasoningEffort: this.options.reasoningEffort
      })
    );
    this.currentProcess = child;
    this.currentTaskId = options.task.id;

    let lastMessage = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      void (async () => {
        try {
          const progress = extractCodexProgress(line);
          if (progress) {
            lastMessage = progress;
            await options.onProgress(progress);
          }
        } catch {
          // Unknown JSONL shapes from Codex are ignored for MVP progress extraction.
        }
      })();
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      void options.onFailure(error);
    });

    child.on("close", (code) => {
      const wasCurrent = this.currentTaskId === options.task.id;
      if (wasCurrent) {
        this.currentProcess = undefined;
        this.currentTaskId = undefined;
      }

      void (async () => {
        if (code === 0) await options.onComplete(lastMessage || "任务已完成。");
        else await options.onFailure(new Error(stderr || `codex exited with ${code}`));
      })();
    });
  }

  cancelCurrent(taskId?: string): boolean {
    if (!this.currentProcess) return false;
    if (taskId && this.currentTaskId !== taskId) return false;
    this.currentProcess.kill("SIGTERM");
    this.currentProcess = undefined;
    this.currentTaskId = undefined;
    return true;
  }
}
