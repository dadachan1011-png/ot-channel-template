import logging
import os

os.environ.pop("SSLKEYLOGFILE", None)

import dingtalk_stream


def load_shared_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8-sig") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value)


class ProbeEventHandler(dingtalk_stream.EventHandler):
    async def process(self, event):
        print(f"[probe] EVENT topic={event.headers.topic} type={event.headers.event_type} data={event.data}", flush=True)
        return dingtalk_stream.AckMessage.STATUS_OK, "OK"


class ProbeBotHandler(dingtalk_stream.ChatbotHandler):
    async def process(self, callback):
        incoming = dingtalk_stream.ChatbotMessage.from_dict(callback.data)
        print(
            "[probe] BOT "
            f"msg_id={incoming.message_id} "
            f"sender_staff_id={incoming.sender_staff_id} "
            f"conversation_id={incoming.conversation_id} "
            f"text={getattr(incoming.text, 'content', '')}",
            flush=True,
        )
        return dingtalk_stream.AckMessage.STATUS_OK, "OK"


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    env_path = os.environ.get("CHANNEL_SHARED_ENV_PATH") or os.environ.get("CODEXPROJECTS_ENV_PATH") or ".env"
    load_shared_env(env_path)
    client_id = os.environ["DINGTALK_CLIENT_ID"]
    client_secret = os.environ["DINGTALK_CLIENT_SECRET"]
    credential = dingtalk_stream.Credential(client_id, client_secret)
    client = dingtalk_stream.DingTalkStreamClient(credential)
    client.register_all_event_handler(ProbeEventHandler())
    client.register_callback_handler(dingtalk_stream.ChatbotMessage.TOPIC, ProbeBotHandler())
    print("[probe] starting python dingtalk stream client", flush=True)
    client.start_forever()


if __name__ == "__main__":
    main()
