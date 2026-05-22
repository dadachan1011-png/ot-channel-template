import { spawn } from "node:child_process";

export function runLarkCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const { file, finalArgs } = buildLarkInvocation(command, args);
    const child = spawn(file, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${file} exited with ${code}`));
    });
  });
}

export function buildLarkInvocation(command: string, args: string[]): { file: string; finalArgs: string[] } {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".ps1")) {
    return {
      file: "powershell.exe",
      finalArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args]
    };
  }

  return { file: command, finalArgs: args };
}
