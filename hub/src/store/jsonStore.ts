import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HubState } from "../domain.js";

export const emptyState = (): HubState => ({
  tasks: [],
  confirmations: [],
  envelopes: [],
  deliveryAttempts: [],
  incomingMessages: [],
  conversationSummaries: []
});

export class JsonStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<HubState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<HubState>;
      return {
        ...emptyState(),
        ...parsed,
        tasks: parsed.tasks ?? [],
        confirmations: parsed.confirmations ?? [],
        envelopes: parsed.envelopes ?? [],
        deliveryAttempts: parsed.deliveryAttempts ?? [],
        incomingMessages: parsed.incomingMessages ?? [],
        conversationSummaries: parsed.conversationSummaries ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
  }

  async save(state: HubState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}
