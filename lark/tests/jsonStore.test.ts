import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../src/store/jsonStore.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("JsonStore", () => {
  it("creates empty state when file is missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "bridge-store-"));
    const store = new JsonStore(join(dir, "state.json"));

    await expect(store.load()).resolves.toEqual({
      tasks: [],
      confirmations: [],
      notifications: []
    });
  });

  it("saves and reloads state", async () => {
    dir = await mkdtemp(join(tmpdir(), "bridge-store-"));
    const store = new JsonStore(join(dir, "state.json"));
    const state = {
      tasks: [],
      confirmations: [],
      notifications: [{ id: "n_1", title: "Done", status: "success" as const, body: "ok", createdAt: "now" }]
    };

    await store.save(state);

    await expect(store.load()).resolves.toEqual(state);
  });
});
