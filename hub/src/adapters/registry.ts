import type { ChannelAdapter, ChannelName } from "../domain.js";

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelName, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: ChannelName): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }
}
