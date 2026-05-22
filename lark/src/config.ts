import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadSharedDotenv();
loadDotenv();

const envSchema = z.object({
  LARK_ALLOWED_OPEN_ID: z.string().min(1),
  LARK_NOTIFY_CHAT_ID: z.string().optional(),
  LARK_NOTIFY_USER_ID: z.string().optional(),
  LARK_CLI_PATH: z.string().default(defaultLarkCliPath()),
  CODEX_CLI_PATH: z.string().default("codex"),
  CODEX_MODEL: z.string().default("gpt-5.5"),
  CODEX_REASONING_EFFORT: z.string().default("medium"),
  ALLOWED_WORKSPACE_ROOT: z.string().default("E:\\Projects\\active"),
  STATE_FILE: z.string().default(".local/state.json"),
  NOTIFY_PORT: z.coerce.number().int().positive().default(4766),
  PROGRESS_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  HUB_URL: z.string().url().optional(),
  ACK_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  ACK_EMOJI: z.string().default("👀"),
  TYPING_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  TYPING_AFTER_MS: z.coerce.number().int().nonnegative().default(5000),
  LONG_TYPING_AFTER_MS: z.coerce.number().int().nonnegative().default(30000),
  TYPING_TEXT: z.string().default("处理中：正在判断你的意图"),
  LONG_TYPING_TEXT: z.string().default("还在处理：已进入深度判断")
});

function defaultLarkCliPath(): string {
  if (process.platform !== "win32") return "lark-cli";
  const appData = process.env.APPDATA;
  return appData ? `${appData}\\npm\\lark-cli.ps1` : "lark-cli";
}

export type AppConfig = {
  allowedOpenId: string;
  notifyChatId?: string;
  notifyUserId?: string;
  larkCliPath: string;
  codexCliPath: string;
  codexModel: string;
  codexReasoningEffort: string;
  allowedWorkspaceRoot: string;
  stateFile: string;
  notifyPort: number;
  progressMinIntervalMs: number;
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
  const parsed = envSchema.parse(env);
  if (!parsed.LARK_NOTIFY_CHAT_ID && !parsed.LARK_NOTIFY_USER_ID) {
    throw new Error("Either LARK_NOTIFY_CHAT_ID or LARK_NOTIFY_USER_ID is required");
  }

  return {
    allowedOpenId: parsed.LARK_ALLOWED_OPEN_ID,
    notifyChatId: parsed.LARK_NOTIFY_CHAT_ID,
    notifyUserId: parsed.LARK_NOTIFY_USER_ID,
    larkCliPath: parsed.LARK_CLI_PATH,
    codexCliPath: parsed.CODEX_CLI_PATH,
    codexModel: parsed.CODEX_MODEL,
    codexReasoningEffort: parsed.CODEX_REASONING_EFFORT,
    allowedWorkspaceRoot: parsed.ALLOWED_WORKSPACE_ROOT,
    stateFile: parsed.STATE_FILE,
    notifyPort: parsed.NOTIFY_PORT,
    progressMinIntervalMs: parsed.PROGRESS_MIN_INTERVAL_MS,
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

function loadSharedDotenv(): void {
  const sharedEnvPath = process.env.CHANNEL_SHARED_ENV_PATH ?? process.env.CODEXPROJECTS_ENV_PATH;
  if (!sharedEnvPath) return;
  if (existsSync(sharedEnvPath)) loadDotenv({ path: sharedEnvPath });
}
