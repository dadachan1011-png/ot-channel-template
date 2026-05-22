import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeState } from "../domain.js";

const emptyState: BridgeState = {
  tasks: [],
  confirmations: [],
  notifications: []
};

export class JsonStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<BridgeState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as BridgeState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(emptyState);
      }
      throw error;
    }
  }

  async save(state: BridgeState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}
