import type { ParsedCommand } from "../commands/parser.js";
import type { HubState, IncomingChannelMessage } from "../domain.js";

export type InterpretedIntent =
  | ParsedCommand
  | {
      kind: "assistant_reply";
      title: string;
      text: string;
    };

export type IntentInterpreter = {
  interpret(input: { message: IncomingChannelMessage; state: HubState }): Promise<InterpretedIntent>;
};
