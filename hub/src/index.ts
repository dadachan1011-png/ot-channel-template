import { loadConfig } from "./config.js";
import { createHubServer } from "./server.js";
import { JsonStore } from "./store/jsonStore.js";

const config = loadConfig();
const app = createHubServer({
  store: new JsonStore(config.stateFile),
  dingtalkNotifyUrl: config.dingtalkNotifyUrl,
  larkNotifyUrl: config.larkNotifyUrl,
  codexCliPath: config.codexCliPath,
  codexCliArgsPrefix: config.codexCliArgsPrefix,
  intentModel: config.intentModel,
  intentReasoningEffort: config.intentReasoningEffort,
  intentTimeoutMs: config.intentTimeoutMs,
  incomingDebounceMs: config.incomingDebounceMs,
  memoryRoot: config.memoryRoot,
  memoryDailyReportEnabled: config.memoryDailyReportEnabled,
  memoryDailyReportHour: config.memoryDailyReportHour,
  memoryOwnerSenderId: config.memoryOwnerSenderId,
  assistantStylePrompt: config.assistantStylePrompt,
  codexStateRoot: config.codexStateRoot,
  workspaceRoot: config.workspaceRoot,
  chatEnabled: config.chatEnabled,
  openAiApiKey: config.openAiApiKey,
  openAiBaseUrl: config.openAiBaseUrl,
  openAiModel: config.openAiModel,
  openAiTimeoutMs: config.openAiTimeoutMs,
  openAiMaxRetries: config.openAiMaxRetries,
  openAiUserAgent: config.openAiUserAgent,
  openAiExtraHeaders: config.openAiExtraHeaders,
  audioTranscriptionCommand: config.audioTranscriptionCommand,
  feishuReadCommand: config.feishuReadCommand,
  feishuSheetReadCommand: config.feishuSheetReadCommand,
  feishuAppId: config.feishuAppId,
  feishuAppSecret: config.feishuAppSecret
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`[channel-hub] listening on http://127.0.0.1:${config.port}`);
});
