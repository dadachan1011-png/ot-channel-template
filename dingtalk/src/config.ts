import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadSharedDotenv();
loadDotenv();

const envSchema = z.object({
  DINGTALK_CLIENT_ID: z.string().min(1),
  DINGTALK_CLIENT_SECRET: z.string().min(1),
  DINGTALK_ALLOWED_SENDER_STAFF_ID: z.string().default(""),
  DINGTALK_ROBOT_CODE: z.string().default(""),
  DINGTALK_NOTIFY_USER_ID: z.string().default(""),
  CODEX_CLI_PATH: z.string().default("codex"),
  CODEX_MODEL: z.string().default("gpt-5.5"),
  CODEX_REASONING_EFFORT: z.string().default("medium"),
  ALLOWED_WORKSPACE_ROOT: z.string().default("E:\\Projects\\active"),
  STATE_FILE: z.string().default(".local/state.json"),
  NOTIFY_PORT: z.coerce.number().int().positive().default(4767),
  PROGRESS_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  CODEX_PROGRESS_UPDATES_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  HUB_URL: z.string().url().optional(),
  ACK_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() !== "false"),
  ACK_EMOJI: z.string().default(""),
  TYPING_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() !== "false"),
  TYPING_AFTER_MS: z.coerce.number().int().nonnegative().default(5000),
  LONG_TYPING_AFTER_MS: z.coerce.number().int().nonnegative().default(30000),
  TYPING_TEXT: z.string().default("我在看"),
  LONG_TYPING_TEXT: z.string().default("还在处理")
});

export type AppConfig = {
  clientId: string;
  clientSecret: string;
  allowedSenderStaffId: string;
  robotCode: string;
  notifyUserId: string;
  codexCliPath: string;
  codexModel: string;
  codexReasoningEffort: string;
  allowedWorkspaceRoot: string;
  stateFile: string;
  notifyPort: number;
  progressMinIntervalMs: number;
  codexProgressUpdatesEnabled: boolean;
  hubUrl?: string;
  ackEnabled: boolean;
  ackEmoji: string;
  typingEnabled: boolean;
  typingAfterMs: number;
  longTypingAfterMs: number;
  typingText: string;
  longTypingText: string;
};

export function loadConfigFromEnv(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(normalizeEnv(env));

  return {
    clientId: parsed.DINGTALK_CLIENT_ID,
    clientSecret: parsed.DINGTALK_CLIENT_SECRET,
    allowedSenderStaffId: parsed.DINGTALK_ALLOWED_SENDER_STAFF_ID,
    robotCode: parsed.DINGTALK_ROBOT_CODE || parsed.DINGTALK_CLIENT_ID,
    notifyUserId: parsed.DINGTALK_NOTIFY_USER_ID || parsed.DINGTALK_ALLOWED_SENDER_STAFF_ID,
    codexCliPath: parsed.CODEX_CLI_PATH,
    codexModel: parsed.CODEX_MODEL,
    codexReasoningEffort: parsed.CODEX_REASONING_EFFORT,
    allowedWorkspaceRoot: parsed.ALLOWED_WORKSPACE_ROOT,
    stateFile: parsed.STATE_FILE,
    notifyPort: parsed.NOTIFY_PORT,
    progressMinIntervalMs: parsed.PROGRESS_MIN_INTERVAL_MS,
    codexProgressUpdatesEnabled: parsed.CODEX_PROGRESS_UPDATES_ENABLED,
    hubUrl: parsed.HUB_URL,
    ackEnabled: parsed.ACK_ENABLED,
    ackEmoji: parsed.ACK_EMOJI,
    typingEnabled: parsed.TYPING_ENABLED,
    typingAfterMs: parsed.TYPING_AFTER_MS,
    longTypingAfterMs: parsed.LONG_TYPING_AFTER_MS,
    typingText: parsed.TYPING_TEXT,
    longTypingText: parsed.LONG_TYPING_TEXT
  };
}

function normalizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) normalized[key.toUpperCase()] ??= value;
  }
  normalized.DINGTALK_CLIENT_ID ??= normalized.DINGTALK_APP_KEY;
  normalized.DINGTALK_CLIENT_SECRET ??= normalized.DINGTALK_APP_SECRET;
  return normalized;
}

function loadSharedDotenv(): void {
  const sharedEnvPath = process.env.CHANNEL_SHARED_ENV_PATH ?? process.env.CODEXPROJECTS_ENV_PATH;
  if (!sharedEnvPath) return;
  if (existsSync(sharedEnvPath)) loadDotenv({ path: sharedEnvPath });
}
