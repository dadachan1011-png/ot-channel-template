import type { ChannelEnvelope, ChannelName, PreferredChannel, Priority } from "../domain.js";

export type RoutingPolicy = {
  routes: Record<Priority, ChannelName[]>;
  fallback: Record<ChannelName, ChannelName[]>;
  dedupeMs: Partial<Record<Priority, number>>;
  confirmations: {
    defaultChannel: ChannelName;
    allowCrossChannelResolution: boolean;
    requireTargetWhenMultiplePending: boolean;
  };
};

export const defaultRoutingPolicy: RoutingPolicy = {
  routes: {
    P0: ["dingtalk", "lark"],
    P1: ["dingtalk"],
    P2: ["lark"],
    P3: []
  },
  fallback: {
    dingtalk: ["lark"],
    lark: ["dingtalk"]
  },
  dedupeMs: {
    P0: 30_000,
    P1: 5 * 60_000,
    P2: 5 * 60_000,
    P3: 30 * 60_000
  },
  confirmations: {
    defaultChannel: "dingtalk",
    allowCrossChannelResolution: true,
    requireTargetWhenMultiplePending: true
  }
};

export function routeEnvelope(envelope: ChannelEnvelope, sourceChannel?: ChannelName): ChannelName[] {
  if (envelope.preferredChannel !== "auto") return channelsFromPreferred(envelope.preferredChannel);

  if (envelope.type === "confirmation" || envelope.requiresReply) {
    if (envelope.priority === "P0") return defaultRoutingPolicy.routes.P0;
    return [defaultRoutingPolicy.confirmations.defaultChannel];
  }

  if (sourceChannel && envelope.type === "task" && (envelope.priority === "P1" || envelope.priority === "P2")) {
    return [sourceChannel];
  }

  return defaultRoutingPolicy.routes[envelope.priority];
}

export function fallbackChannels(channel: ChannelName): ChannelName[] {
  return defaultRoutingPolicy.fallback[channel] ?? [];
}

export function shouldDedupe(input: {
  envelope: ChannelEnvelope;
  existing: ChannelEnvelope[];
  now?: number;
}): boolean {
  const windowMs = defaultRoutingPolicy.dedupeMs[input.envelope.priority] ?? 0;
  if (windowMs <= 0) return false;

  const now = input.now ?? Date.now();
  const semanticKey = makeSemanticKey(input.envelope);
  return input.existing.some((candidate) => {
    if (candidate.id === input.envelope.id) return true;
    if (makeSemanticKey(candidate) !== semanticKey) return false;
    return now - Date.parse(candidate.createdAt) <= windowMs;
  });
}

export function makeSemanticKey(envelope: ChannelEnvelope): string {
  return [envelope.taskId ?? "", envelope.type, envelope.priority, envelope.title].join("|");
}

function channelsFromPreferred(preferred: PreferredChannel): ChannelName[] {
  if (preferred === "both") return ["dingtalk", "lark"];
  if (preferred === "auto") return [];
  return [preferred];
}
