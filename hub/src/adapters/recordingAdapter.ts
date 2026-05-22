import type { ChannelAdapter, ChannelName, DeliveryResult, OutgoingChannelMessage } from "../domain.js";

export class RecordingAdapter implements ChannelAdapter {
  readonly sent: OutgoingChannelMessage[] = [];

  constructor(readonly name: ChannelName) {}

  async send(message: OutgoingChannelMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return {
      ok: true,
      platformMessageId: `${this.name}_${this.sent.length}`
    };
  }
}
