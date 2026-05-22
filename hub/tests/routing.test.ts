import { describe, expect, it } from "vitest";
import type { ChannelEnvelope } from "../src/domain.js";
import { routeEnvelope } from "../src/routing/policy.js";

function envelope(patch: Partial<ChannelEnvelope>): ChannelEnvelope {
  return {
    id: "env_1",
    type: "report",
    priority: "P2",
    source: "automation",
    requiresReply: false,
    preferredChannel: "auto",
    title: "title",
    body: "body",
    createdAt: "2026-05-16T00:00:00.000Z",
    ...patch
  };
}

describe("routeEnvelope", () => {
  it("routes priority by the confirmed matrix", () => {
    expect(routeEnvelope(envelope({ priority: "P0" }))).toEqual(["dingtalk", "lark"]);
    expect(routeEnvelope(envelope({ priority: "P1" }))).toEqual(["dingtalk"]);
    expect(routeEnvelope(envelope({ priority: "P2" }))).toEqual(["lark"]);
    expect(routeEnvelope(envelope({ priority: "P3" }))).toEqual([]);
  });

  it("routes confirmations to DingTalk unless P0 double-send is required", () => {
    expect(routeEnvelope(envelope({ type: "confirmation", priority: "P1", requiresReply: true }))).toEqual(["dingtalk"]);
    expect(routeEnvelope(envelope({ type: "confirmation", priority: "P0", requiresReply: true }))).toEqual(["dingtalk", "lark"]);
  });

  it("honors explicit user route overrides", () => {
    expect(routeEnvelope(envelope({ preferredChannel: "lark" }))).toEqual(["lark"]);
    expect(routeEnvelope(envelope({ preferredChannel: "both" }))).toEqual(["dingtalk", "lark"]);
  });
});
