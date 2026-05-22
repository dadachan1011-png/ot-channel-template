import express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { BridgeNotification } from "../domain.js";
import type { LarkClient } from "../lark/larkClient.js";
import type { JsonStore } from "../store/jsonStore.js";

const payloadSchema = z.object({
  title: z.string().min(1),
  status: z.enum(["success", "warning", "failed", "info"]),
  body: z.string().min(1),
  source: z.string().optional(),
  actions: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        style: z.enum(["primary", "danger", "default"]).optional()
      })
    )
    .optional(),
  metadata: z.record(z.unknown()).optional()
});

export function parseNotificationPayload(input: unknown): Omit<BridgeNotification, "id" | "createdAt"> {
  return payloadSchema.parse(input);
}

export function formatNotification(notification: BridgeNotification): string {
  const lines = [
    `自动化结果：${notification.title}`,
    "",
    `状态：${notification.status}`,
    notification.source ? `来源：${notification.source}` : undefined,
    "",
    notification.body
  ]
    .filter(Boolean);

  if (notification.actions && notification.actions.length > 0) {
    lines.push("", "可直接回复：");
    for (const action of notification.actions) lines.push(`- ${action.value}`);
  }

  return lines.join("\n");
}

export function splitNotificationText(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) chunks.push(text.slice(index, index + maxLength));
  return chunks;
}

export function createNotifyServer(options: {
  store: JsonStore;
  lark: Pick<LarkClient, "sendText" | "sendTextToUser">;
  notifyChatId?: string;
  notifyUserId?: string;
}) {
  if (!options.notifyChatId && !options.notifyUserId) {
    throw new Error("notifyChatId or notifyUserId is required");
  }

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.post("/notify", async (req, res, next) => {
    try {
      const payload = parseNotificationPayload(req.body);
      const notification: BridgeNotification = {
        ...payload,
        id: `n_${nanoid(8)}`,
        createdAt: new Date().toISOString()
      };
      const state = await options.store.load();
      state.notifications.push(notification);
      await options.store.save(state);
      const messages = splitNotificationText(formatNotification(notification));
      for (const message of messages) {
        if (options.notifyChatId) {
          await options.lark.sendText(options.notifyChatId, message);
        } else {
          await options.lark.sendTextToUser(options.notifyUserId!, message);
        }
      }
      res.json({ ok: true, id: notification.id });
    } catch (error) {
      next(error);
    }
  });

  return app;
}
