import type { ChannelAdapter, ChannelName, DeliveryResult, OutgoingChannelMessage } from "../domain.js";

export class HttpNotifyAdapter implements ChannelAdapter {
  constructor(
    readonly name: ChannelName,
    private readonly notifyUrl: string,
    private readonly timeoutMs = 5000
  ) {}

  async send(message: OutgoingChannelMessage): Promise<DeliveryResult> {
    if (this.name === "dingtalk" && message.metadata?.bridgeManaged === true) {
      return {
        ok: true,
        platformMessageId: `bridge-managed:${message.envelopeId}`
      };
    }

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    try {
      const response = await Promise.race([
        fetch(this.notifyUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            title: message.title,
            status: statusFromPriority(message.priority),
            body: message.body,
            source: "channel-hub",
            actions: message.actions,
            metadata: {
              envelopeId: message.envelopeId,
              taskId: message.taskId,
              confirmationId: message.confirmationId,
              ...message.metadata
            }
          })
        }),
        new Promise<Response>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`Notify request timed out after ${this.timeoutMs}ms`));
          }, this.timeoutMs);
        })
      ]);

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${await response.text()}`
        };
      }

      const payload = (await response.json().catch(() => undefined)) as { id?: string } | undefined;
      return {
        ok: true,
        platformMessageId: payload?.id
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function statusFromPriority(priority: OutgoingChannelMessage["priority"]): "success" | "warning" | "failed" | "info" {
  if (priority === "P0" || priority === "P1") return "warning";
  if (priority === "P2") return "info";
  return "success";
}
