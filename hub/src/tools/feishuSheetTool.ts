import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FeishuSheetOptions = {
  readCommand?: string[];
  timeoutMs?: number;
};

export type FeishuSheetResult = {
  title: string;
  text: string;
};

export function isFeishuSheetPrompt(prompt: string): boolean {
  return /feishu_sheet_read|飞书表格|电子表格|sheets?|spreadsheet|feishu\.cn\/(?:sheets|base)/i.test(prompt);
}

export async function executeFeishuSheetRead(input: { query: string }, options: FeishuSheetOptions): Promise<FeishuSheetResult> {
  const url = extractUrls(input.query).find((item) => /(?:^|\.)feishu\.cn$/i.test(item.hostname));
  if (!url) return { title: "飞书表格没读到", text: "我没在这条消息里识别到飞书表格链接。" };

  const token = extractSheetToken(url);
  const sheetId = extractSheetId(url);
  const command = options.readCommand?.length ? options.readCommand : defaultSheetReadCommand();
  try {
    const text = await readWithCommand(command, {
      url: url.toString(),
      spreadsheetToken: token,
      sheetId,
      timeoutMs: options.timeoutMs ?? 60000
    });
    return { title: "飞书表格读取", text: summarizeSheetText(text) };
  } catch (error) {
    return {
      title: "飞书表格没读到",
      text: `飞书表格读取失败：${error instanceof Error ? error.message : String(error)}\n\n我已经接入飞书表格读取链路，但这类表格通常还需要飞书 CLI 已登录、表格授权给当前账号，或链接里带可读 sheet token。`
    };
  }
}

function defaultSheetReadCommand(): string[] {
  return [
    "cmd.exe",
    "/d",
    "/s",
    "/c",
    "npx --yes @larksuite/cli@latest sheets +read --spreadsheet-token {spreadsheetToken} --sheet-id {sheetId} --range A1:AZ200 --value-render-option FormattedValue --format json"
  ];
}

async function readWithCommand(
  command: string[],
  input: { url: string; spreadsheetToken: string; sheetId: string; timeoutMs: number }
): Promise<string> {
  const [executable, ...rawArgs] = command;
  if (!executable) throw new Error("FEISHU_SHEET_READ_COMMAND 为空");
  const args = rawArgs.map((arg) =>
    arg
      .replace(/\{url\}/g, input.url)
      .replace(/\{spreadsheetToken\}/g, input.spreadsheetToken)
      .replace(/\{sheetId\}/g, input.sheetId)
  );
  const { stdout, stderr } = await execFileAsync(executable, args, {
    timeout: input.timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  const text = parseOutput(stdout);
  if (!text.trim()) throw new Error(`CLI 没有输出正文${stderr.trim() ? `：${stderr.trim().slice(0, 200)}` : ""}`);
  return text;
}

function parseOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const json = findJsonPayload(trimmed);
  try {
    return collectStrings(JSON.parse(json ?? trimmed)).join("\n").trim() || (json ?? trimmed);
  } catch {
    return trimmed;
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  const record = value as Record<string, unknown>;
  return ["data", "valueRange", "values", "items", "rows", "columns", "title", "text"].flatMap((key) => collectStrings(record[key]));
}

function summarizeSheetText(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [`我读到飞书表格内容了，共 ${text.length} 字。`, "", ...lines.slice(0, 20).map((line) => `- ${line.slice(0, 160)}`)].join("\n");
}

function extractUrls(input: string): URL[] {
  return [...input.matchAll(/https?:\/\/[^\s<>"，。！？]+/gi)]
    .map((match) => {
      try {
        return new URL(match[0]);
      } catch {
        return undefined;
      }
    })
    .filter((url): url is URL => Boolean(url));
}

function extractSheetToken(url: URL): string {
  const match = url.pathname.match(/\/(?:sheets|base)\/([^/?#]+)/i);
  if (!match?.[1]) throw new Error("飞书表格链接里没有 spreadsheet token");
  return decodeURIComponent(match[1]);
}

function extractSheetId(url: URL): string {
  return url.searchParams.get("sheet") ?? url.hash.match(/sheet=([^&]+)/)?.[1] ?? "";
}

function findJsonPayload(input: string): string | undefined {
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "{" && char !== "[") continue;
    const candidate = input.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
