import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve, win32 } from "node:path";
import type { ProjectContext, ProjectProcess, ProjectSnapshot } from "../domain.js";

export class LocalProjectContext implements ProjectContext {
  constructor(private readonly workspaceRoot: string) {}

  findProject(target: string): ProjectSnapshot | undefined {
    const projectPath = this.findProjectPath(target);
    if (!projectPath) return undefined;
    const name = basename(projectPath);
    return {
      name,
      path: projectPath,
      runningProcesses: this.findRunningProcesses(projectPath, name)
    };
  }

  private findProjectPath(target: string): string | undefined {
    const normalizedTarget = normalizeProjectName(target);
    if (!normalizedTarget || !existsSync(this.workspaceRoot)) return undefined;

    const direct = resolve(this.workspaceRoot, normalizedTarget);
    if (isInside(this.workspaceRoot, direct) && existsSync(direct) && statSync(direct).isDirectory()) {
      return direct;
    }

    const entries = readdirSync(this.workspaceRoot, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && normalizeProjectName(entry.name) === normalizedTarget);
    return match ? join(this.workspaceRoot, match.name) : undefined;
  }

  private findRunningProcesses(projectPath: string, projectName: string): ProjectProcess[] {
    const rows = readProcessRows();
    const normalizedPath = projectPath.toLowerCase();
    const normalizedName = projectName.toLowerCase();
    return rows
      .filter((row) => {
        const commandLine = row.commandLine.toLowerCase();
        return commandLine.includes(normalizedPath) || commandLine.includes(normalizedName);
      })
      .map((row) => ({
        pid: row.pid,
        name: row.name,
        commandLine: shortenCommandLine(row.commandLine)
      }));
  }
}

function normalizeProjectName(input: string): string {
  return input
    .trim()
    .replace(/[?？!！。；;，,].*$/u, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function isInside(root: string, target: string): boolean {
  const relative = win32.relative(resolve(root), resolve(target));
  return relative === "" || (!relative.startsWith("..") && !win32.isAbsolute(relative));
}

function readProcessRows(): Array<{ pid: number; name: string; commandLine: string }> {
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
      ],
      { encoding: "utf8", windowsHide: true, timeout: 3000, maxBuffer: 1024 * 1024 }
    ).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row) => {
      const value = row as { ProcessId?: unknown; Name?: unknown; CommandLine?: unknown };
      const pid = Number(value.ProcessId);
      const name = typeof value.Name === "string" ? value.Name : "";
      const commandLine = typeof value.CommandLine === "string" ? value.CommandLine : "";
      return Number.isFinite(pid) && name && commandLine ? [{ pid, name, commandLine }] : [];
    });
  } catch {
    return [];
  }
}

function shortenCommandLine(input: string): string {
  return input.length <= 240 ? input : `${input.slice(0, 237)}...`;
}
