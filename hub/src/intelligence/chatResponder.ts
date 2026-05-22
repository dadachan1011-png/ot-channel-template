import type { HubState, IncomingChannelMessage } from "../domain.js";

export type ChatResponse = {
  title: string;
  text: string;
};

export type ChatResponder = {
  respond(input: { message: IncomingChannelMessage; state: HubState }): Promise<ChatResponse | undefined>;
};

