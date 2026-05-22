type WebhookSender = (url: string, body: unknown) => Promise<void>;
type ApiCaller = (options: { method: "GET" | "POST"; url: string; headers?: Record<string, string>; body?: unknown }) => Promise<unknown>;

export type DingTalkCardAction = {
  label: string;
  value: string;
  style?: "primary" | "danger" | "default";
};

export class DingTalkClient {
  private readonly conversationWebhooks = new Map<string, string>();
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private robotCode: string,
    private notifyUserId: string,
    private readonly sendWebhook: WebhookSender = postWebhook,
    private readonly callApi: ApiCaller = requestJson
  ) {}

  updateTargets(input: { robotCode?: string; notifyUserId?: string }): void {
    if (input.robotCode) this.robotCode = input.robotCode;
    if (input.notifyUserId) this.notifyUserId = input.notifyUserId;
  }

  rememberSessionWebhook(conversationId: string, sessionWebhook?: string): void {
    if (sessionWebhook) this.conversationWebhooks.set(conversationId, sessionWebhook);
  }

  async sendText(conversationId: string, text: string): Promise<void> {
    const webhook = this.conversationWebhooks.get(conversationId);
    if (!webhook) throw new Error(`No active DingTalk session webhook for conversation: ${conversationId}`);
    await this.sendWebhook(webhook, textMessage(text));
  }

  async sendActionCard(conversationId: string, input: { title: string; text: string; actions: DingTalkCardAction[] }): Promise<void> {
    const webhook = this.conversationWebhooks.get(conversationId);
    if (!webhook) throw new Error(`No active DingTalk session webhook for conversation: ${conversationId}`);
    await this.sendWebhook(webhook, actionCardMessage(input));
  }

  async sendNotifyText(text: string): Promise<void> {
    if (!this.notifyUserId) throw new Error("DingTalk notify user id is not configured");
    const token = await this.getAccessToken();
    await this.callApi({
      method: "POST",
      url: "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      headers: {
        "x-acs-dingtalk-access-token": token,
        "Content-Type": "application/json"
      },
      body: {
        robotCode: this.robotCode,
        userIds: [this.notifyUserId],
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content: text })
      }
    });
  }

  async getMessageFileDownloadUrl(downloadCode: string): Promise<string> {
    if (!downloadCode) throw new Error("downloadCode is required");
    const token = await this.getAccessToken();
    const result = (await this.callApi({
      method: "POST",
      url: "https://api.dingtalk.com/v1.0/robot/messageFiles/download",
      headers: {
        "x-acs-dingtalk-access-token": token,
        "Content-Type": "application/json"
      },
      body: {
        downloadCode,
        robotCode: this.robotCode
      }
    })) as { downloadUrl?: string };

    if (!result.downloadUrl) throw new Error("DingTalk file download response is missing downloadUrl");
    return result.downloadUrl;
  }

  async replyText(messageId: string, text: string): Promise<void> {
    const webhook = this.conversationWebhooks.get(messageId);
    if (!webhook) throw new Error(`No active DingTalk session webhook for message: ${messageId}`);
    await this.sendWebhook(webhook, textMessage(text));
  }

  async replyActionCard(messageId: string, input: { title: string; text: string; actions: DingTalkCardAction[] }): Promise<void> {
    const webhook = this.conversationWebhooks.get(messageId);
    if (!webhook) throw new Error(`No active DingTalk session webhook for message: ${messageId}`);
    await this.sendWebhook(webhook, actionCardMessage(input));
  }

  rememberMessageWebhook(messageId: string, sessionWebhook?: string): void {
    if (sessionWebhook) this.conversationWebhooks.set(messageId, sessionWebhook);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt) return this.accessToken.value;

    const result = (await this.callApi({
      method: "POST",
      url: "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      headers: { "Content-Type": "application/json" },
      body: {
        appKey: this.clientId,
        appSecret: this.clientSecret
      }
    })) as { accessToken?: string; expireIn?: number };

    if (!result.accessToken) throw new Error("DingTalk accessToken response is missing accessToken");
    this.accessToken = {
      value: result.accessToken,
      expiresAt: Date.now() + Math.max((result.expireIn ?? 7200) - 300, 60) * 1000
    };
    return result.accessToken;
  }
}

function textMessage(text: string): unknown {
  return {
    msgtype: "text",
    text: { content: text }
  };
}

function actionCardMessage(input: { title: string; text: string; actions: DingTalkCardAction[] }): unknown {
  const actionsText = input.actions.map((action) => `- ${action.value}`).join("\n");
  return {
    msgtype: "actionCard",
    actionCard: {
      title: input.title,
      text: `${input.text}\n\n可直接回复：\n${actionsText}`,
      btnOrientation: "0",
      btns: input.actions.map((action) => ({
        title: action.label,
        actionURL: commandHelpUrl(action.value)
      }))
    }
  };
}

function commandHelpUrl(command: string): string {
  return `https://www.dingtalk.com/?channel-command=${encodeURIComponent(command)}`;
}

async function postWebhook(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`DingTalk webhook failed: ${response.status} ${await response.text()}`);
  }
}

async function requestJson(options: { method: "GET" | "POST"; url: string; headers?: Record<string, string>; body?: unknown }): Promise<unknown> {
  const response = await fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`DingTalk API failed: ${response.status} ${text}`);
  return text ? (JSON.parse(text) as unknown) : {};
}
