import { runLarkCommand } from "./runLarkCommand.js";

type CommandRunner = (cmd: string, args: string[]) => Promise<void>;

export class LarkClient {
  constructor(
    private readonly larkCliPath: string,
    private readonly run: CommandRunner = runLarkCommand
  ) {}

  sendText(chatId: string, text: string): Promise<void> {
    return this.run(this.larkCliPath, [
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--chat-id",
      chatId,
      "--text",
      text
    ]);
  }

  sendTextToUser(userId: string, text: string): Promise<void> {
    return this.run(this.larkCliPath, [
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--user-id",
      userId,
      "--text",
      text
    ]);
  }

  replyText(messageId: string, text: string): Promise<void> {
    return this.run(this.larkCliPath, [
      "im",
      "+messages-reply",
      "--as",
      "bot",
      "--message-id",
      messageId,
      "--text",
      text
    ]);
  }
}
