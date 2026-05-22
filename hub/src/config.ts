import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadSharedDotenv();
loadDotenv();

const schema = z.object({
  HUB_PORT: z.coerce.number().int().positive().default(4770),
  HUB_STATE_FILE: z.string().default(".local/state.json"),
  HUB_DINGTALK_NOTIFY_URL: z.string().url().default("http://127.0.0.1:4767/notify"),
  HUB_LARK_NOTIFY_URL: z.string().url().default("http://127.0.0.1:4766/notify"),
  ALLOWED_WORKSPACE_ROOT: z.string().default("E:\\Projects\\active"),
  CODEX_CLI_PATH: z.string().default(process.execPath),
  CODEX_CLI_ARGS_PREFIX: z.string().default("../node_modules/@openai/codex/bin/codex.js"),
  HUB_INTENT_MODEL: z.string().default("gpt-5.5"),
  HUB_INTENT_REASONING_EFFORT: z.string().default("medium"),
  HUB_INTENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  HUB_INCOMING_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(1200),
  HUB_MEMORY_ROOT: z.string().default("../memory"),
  HUB_MEMORY_DAILY_REPORT_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  HUB_MEMORY_DAILY_REPORT_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  HUB_MEMORY_OWNER_SENDER_ID: z.string().default(""),
  HUB_ASSISTANT_STYLE_PROMPT: z.string().default(""),
  HUB_CODEX_STATE_ROOT: z.string().default(""),
  DINGTALK_ALLOWED_SENDER_STAFF_ID: z.string().default(""),
  HUB_CHAT_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-5.5"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(1),
  OPENAI_USER_AGENT: z.string().default("Channel/1.0"),
  OPENAI_EXTRA_HEADERS_JSON: z.string().default("{}"),
  AUDIO_TRANSCRIPTION_COMMAND: z.string().default(""),
  FEISHU_READ_COMMAND: z.string().default(""),
  FEISHU_SHEET_READ_COMMAND: z.string().default(""),
  LARK_READ_COMMAND: z.string().default(""),
  FEISHU_APP_ID: z.string().default(""),
  FEISHU_APP_SECRET: z.string().default(""),
  LARK_APP_ID: z.string().default(""),
  LARK_APP_SECRET: z.string().default("")
});

export type HubConfig = {
  port: number;
  stateFile: string;
  dingtalkNotifyUrl: string;
  larkNotifyUrl: string;
  workspaceRoot: string;
  codexCliPath: string;
  codexCliArgsPrefix: string[];
  intentModel: string;
  intentReasoningEffort: string;
  intentTimeoutMs: number;
  incomingDebounceMs: number;
  memoryRoot: string;
  memoryDailyReportEnabled: boolean;
  memoryDailyReportHour: number;
  memoryOwnerSenderId: string;
  assistantStylePrompt: string;
  codexStateRoot: string;
  chatEnabled: boolean;
  openAiApiKey: string;
  openAiBaseUrl: string;
  openAiModel: string;
  openAiTimeoutMs: number;
  openAiMaxRetries: number;
  openAiUserAgent: string;
  openAiExtraHeaders: Record<string, string>;
  audioTranscriptionCommand: string[];
  feishuReadCommand: string[];
  feishuSheetReadCommand: string[];
  feishuAppId: string;
  feishuAppSecret: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const parsed = schema.parse(env);
  return {
    port: parsed.HUB_PORT,
    stateFile: resolve(parsed.HUB_STATE_FILE),
    dingtalkNotifyUrl: parsed.HUB_DINGTALK_NOTIFY_URL,
    larkNotifyUrl: parsed.HUB_LARK_NOTIFY_URL,
    workspaceRoot: resolve(parsed.ALLOWED_WORKSPACE_ROOT),
    codexCliPath: parsed.CODEX_CLI_PATH,
    codexCliArgsPrefix: splitCommandArgs(parsed.CODEX_CLI_ARGS_PREFIX),
    intentModel: parsed.HUB_INTENT_MODEL,
    intentReasoningEffort: parsed.HUB_INTENT_REASONING_EFFORT,
    intentTimeoutMs: parsed.HUB_INTENT_TIMEOUT_MS,
    incomingDebounceMs: parsed.HUB_INCOMING_DEBOUNCE_MS,
    memoryRoot: resolve(parsed.HUB_MEMORY_ROOT),
    memoryDailyReportEnabled: parsed.HUB_MEMORY_DAILY_REPORT_ENABLED,
    memoryDailyReportHour: parsed.HUB_MEMORY_DAILY_REPORT_HOUR,
    memoryOwnerSenderId: parsed.HUB_MEMORY_OWNER_SENDER_ID || parsed.DINGTALK_ALLOWED_SENDER_STAFF_ID,
    assistantStylePrompt: parsed.HUB_ASSISTANT_STYLE_PROMPT,
    codexStateRoot: parsed.HUB_CODEX_STATE_ROOT,
    chatEnabled: parsed.HUB_CHAT_ENABLED,
    openAiApiKey: parsed.OPENAI_API_KEY,
    openAiBaseUrl: parsed.OPENAI_BASE_URL,
    openAiModel: parsed.OPENAI_MODEL,
    openAiTimeoutMs: parsed.OPENAI_TIMEOUT_MS,
    openAiMaxRetries: parsed.OPENAI_MAX_RETRIES,
    openAiUserAgent: parsed.OPENAI_USER_AGENT,
    openAiExtraHeaders: parseExtraHeaders(parsed.OPENAI_EXTRA_HEADERS_JSON),
    audioTranscriptionCommand: splitCommandArgs(parsed.AUDIO_TRANSCRIPTION_COMMAND),
    feishuReadCommand: splitCommandArgs(parsed.FEISHU_READ_COMMAND || parsed.LARK_READ_COMMAND),
    feishuSheetReadCommand: splitCommandArgs(parsed.FEISHU_SHEET_READ_COMMAND),
    feishuAppId: parsed.FEISHU_APP_ID || parsed.LARK_APP_ID,
    feishuAppSecret: parsed.FEISHU_APP_SECRET || parsed.LARK_APP_SECRET
  };
}

export function splitCommandArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const char of input.trim()) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = undefined;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) args.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function loadSharedDotenv(): void {
  const sharedEnvPath = process.env.CHANNEL_SHARED_ENV_PATH ?? process.env.CODEXPROJECTS_ENV_PATH;
  if (!sharedEnvPath) return;
  if (existsSync(sharedEnvPath)) loadDotenv({ path: sharedEnvPath });
}

function parseExtraHeaders(input: string): Record<string, string> {
  const parsed = JSON.parse(input || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") output[key] = value;
  }
  return output;
}
