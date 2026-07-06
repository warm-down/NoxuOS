#!/usr/bin/env python3
import asyncio
import json
import os

import websockets


class AlphaCommander:
    def __init__(self):
        self.url = os.getenv("EMPIRE_WS", "ws://localhost:8765")
        self.wake_words = ("alpha", "hey alpha", "commander")
        self.ws = None

    async def connect(self):
        self.ws = await websockets.connect(self.url)
        await self.ws.send(json.dumps({
            "type": "register",
            "agent_id": "alpha_commander",
            "role": "command_interface",
        }))
        print("[ALPHA] Connected to Agent Bus")

    async def process_command(self, command):
        if not self.ws:
            await self.connect()

        message = {
            "type": "command",
            "target": "director",
            "payload": {
                "original": command,
                "requires_approval": self.requires_approval(command),
            },
        }
        await self.ws.send(json.dumps(message))
        print(f"[ALPHA] Routed: {command}")

    def requires_approval(self, command):
        hardware_words = ("turn on", "turn off", "activate", "open", "close", "gpio", "relay", "motor")
        return any(word in command.lower() for word in hardware_words)

    async def repl(self):
        try:
            await self.connect()
        except Exception as error:
            print(f"[ALPHA] Agent Bus offline: {error}")

        while True:
            text = input("Alpha> ").strip()
            if text.lower() in {"exit", "quit"}:
                return

            lower = text.lower()
            wake = next((word for word in self.wake_words if word in lower), None)
            if not wake:
                print('[ALPHA] Prefix commands with "alpha".')
                continue

            command = text.replace(wake, "", 1).strip() or "status"
            await self.process_command(command)


if __name__ == "__main__":
    asyncio.run(AlphaCommander().repl())
